const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDatabase } = require('./roomq-db');
const { PERMISSIONS, ROLES, can, permissionsFor } = require('./permissions');
const { isValidDate, isValidTime } = require('./schedule-rules');

const SESSION_COOKIE = 'roomq_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const MAX_REGISTRATIONS = 10;

const envInt = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
// Limits that apply to reservations made by user (non-admin) accounts.
const RESERVATION_MAX_MINUTES = envInt('ROOMQ_RESERVATION_MAX_MINUTES', 240);
const RESERVATION_HORIZON_DAYS = envInt('ROOMQ_RESERVATION_HORIZON_DAYS', 90);
const RESERVATION_MAX_ACTIVE = envInt('ROOMQ_RESERVATION_MAX_ACTIVE', 5);

// Target response time for core database operations (add, edit, delete, view
// reservations). Requests slower than this are counted and logged so the
// target can be checked against real use.
const RESPONSE_TIME_TARGET_MS = envInt('ROOMQ_RESPONSE_TARGET_MS', 2000);

// Sign-up is limited to the university's own email domains when this is set.
// Empty means any address is accepted. Read when checking rather than at load
// so the setting can be changed (and tested) without restarting the module.
function allowedEmailDomains() {
  return String(process.env.ROOMQ_ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

// School ID as printed on a university ID card: letters, digits and hyphens.
const SCHOOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{3,31}$/;

// Staff portal pages that exist only under public/staff, and the existing
// admin pages/scripts that staff are allowed to use at /staff/<name>.
const STAFF_OWN_PAGES = new Set(['dashboard.html', 'account.html']);
const STAFF_SHARED_PAGES = new Set(['schedules.html', 'conflicts.html', 'classrooms.html']);
const STAFF_SHARED_SCRIPTS = new Set(['schedules.js', 'conflicts.js']);

// Current date/time on the campus clock (ROOMQ_TIMEZONE, else the system zone).
function localNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.ROOMQ_TIMEZONE || undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const trustProxy = () => process.env.ROOMQ_TRUST_PROXY === 'true';

// Send the cookie with Secure only when the browser reached us over HTTPS
// (directly, or via a trusted proxy). Browsers discard Secure cookies set over
// plain HTTP on non-localhost hosts, which would make sign-in silently fail.
function isSecureRequest(request) {
  const forced = process.env.ROOMQ_COOKIE_SECURE;
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  if (request.socket.encrypted) return true;
  return trustProxy() &&
    String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function clientAddress(request) {
  if (trustProxy()) {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || 'unknown';
}

// The signed-in account as the browser sees it. `permissions` lets the UI show
// or hide controls; the server still enforces every permission itself.
function publicUser(user) {
  const firstName = user.firstName !== undefined ? user.firstName : (user.first_name || null);
  const middleName = user.middleName !== undefined ? user.middleName : (user.middle_name || null);
  const lastName = user.lastName !== undefined ? user.lastName : (user.last_name || null);
  const fullName = (user.fullName !== undefined ? user.fullName : user.full_name) ||
    [firstName, middleName, lastName].filter(Boolean).join(' ') || null;
  return {
    firstName,
    middleName,
    lastName,
    fullName,
    email: user.email || null,
    role: user.role,
    permissions: permissionsFor(user.role)
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkNamePart(value, label, required = false) {
  if (value === undefined && !required) return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) {
    throw requestError(`Enter your ${label}.`, 400);
  }
  if (text.length > 60) {
    throw requestError(`Your ${label} must be 60 characters or fewer.`, 400);
  }
  return text || null;
}

function checkRequiredEmail(value) {
  const email = checkEmail(typeof value === 'string' ? value : '');
  if (!email) {
    throw requestError('Enter a valid email address.', 400);
  }
  return email;
}

// Restricts self-registration to authorized university addresses. Accounts an
// administrator creates are exempt: the administrator is the authorizing party.
function checkUniversityEmail(value) {
  const email = checkRequiredEmail(value);
  const domains = allowedEmailDomains();
  if (!domains.length) {
    return email;
  }
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const allowed = domains.some(
    (candidate) => domain === candidate || domain.endsWith(`.${candidate}`)
  );
  if (!allowed) {
    throw requestError(
      `Use your university email address (${domains.map((d) => `@${d}`).join(' or ')}).`,
      400
    );
  }
  return email;
}

function checkSchoolId(value, required = false) {
  if (value === undefined && !required) return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (required) {
      throw requestError('Enter your school ID number.', 400);
    }
    return null;
  }
  if (!SCHOOL_ID_PATTERN.test(text)) {
    throw requestError('School ID must be 4-32 characters using letters, numbers or hyphens.', 400);
  }
  return text;
}

function checkPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw requestError('Password must be between 12 and 128 characters.', 400);
  }
  return value;
}

// Optional text fields: undefined stays undefined (leave unchanged); an empty
// string clears the value.
function checkFullName(value) {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value.trim() : null;
  if (text === null || text.length > 120) {
    throw requestError('Full name must be 120 characters or fewer.', 400);
  }
  return text || null;
}

function checkEmail(value) {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (text === null || text.length > 190 || (text && !EMAIL_PATTERN.test(text))) {
    throw requestError('Enter a valid email address.', 400);
  }
  return text || null;
}

function checkRole(value) {
  if (!ROLES.includes(value)) {
    throw requestError(`Role must be one of: ${ROLES.join(', ')}.`, 400);
  }
  return value;
}

function checkBoolean(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw requestError(`${label} must be true or false.`, 400);
  }
  return value;
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw requestError('Provide the account details as a JSON object.', 400);
  }
  return body;
}

// Hide who owns a reservation from anyone but administrators; tell the viewer
// whether it is their own instead.
function presentSchedule(schedule, viewer) {
  if (!schedule) return schedule;
  if (viewer && viewer.role === 'admin') return schedule;
  const { createdByUserId, createdByEmail, ...rest } = schedule;
  return { ...rest, ownedByCurrentUser: Boolean(viewer && createdByUserId === viewer.id) };
}
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function sendJson(response, status, value, headers = {}) {
  const body = value === undefined ? '' : JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(body);
}

function getCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) {
      return ['', ''];
    }
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([key]) => key));
}

function getToken(request) {
  return getCookies(request.headers.cookie)[SESSION_COOKIE];
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Rolling record of how long API requests take, so the two-second target for
// core database operations can be measured rather than assumed. Kept in memory
// (the most recent samples only) and read back through /api/performance.
function createPerformanceMonitor(targetMs, sampleSize = 500) {
  const samples = [];
  const byRoute = new Map();
  let total = 0;
  let slow = 0;

  return {
    targetMs,
    record(route, durationMs) {
      total += 1;
      if (durationMs > targetMs) {
        slow += 1;
        console.warn(
          `RoomQ slow response: ${route} took ${durationMs.toFixed(0)}ms (target ${targetMs}ms).`
        );
      }
      samples.push(durationMs);
      if (samples.length > sampleSize) samples.shift();
      const entry = byRoute.get(route) || { route, count: 0, totalMs: 0, maxMs: 0, slow: 0 };
      entry.count += 1;
      entry.totalMs += durationMs;
      entry.maxMs = Math.max(entry.maxMs, durationMs);
      if (durationMs > targetMs) entry.slow += 1;
      byRoute.set(route, entry);
    },
    snapshot() {
      const sorted = [...samples].sort((left, right) => left - right);
      const percentile = (fraction) => (sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
        : 0);
      const round = (value) => Math.round(value * 10) / 10;
      return {
        targetMs,
        totalRequests: total,
        sampled: sorted.length,
        slowRequests: slow,
        withinTargetPercent: total ? round(((total - slow) / total) * 100) : 100,
        averageMs: sorted.length ? round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        medianMs: round(percentile(0.5)),
        p95Ms: round(percentile(0.95)),
        maxMs: round(sorted.length ? sorted[sorted.length - 1] : 0),
        meetsTarget: slow === 0,
        routes: [...byRoute.values()]
          .map((entry) => ({
            route: entry.route,
            count: entry.count,
            averageMs: round(entry.totalMs / entry.count),
            maxMs: round(entry.maxMs),
            slow: entry.slow
          }))
          .sort((left, right) => right.averageMs - left.averageMs)
          .slice(0, 12)
      };
    }
  };
}

// Collapses "/api/schedules/37" to "/api/schedules/:id" so metrics group by
// endpoint rather than by individual record.
function routeLabel(method, pathname) {
  const generic = pathname
    .replace(/^\/api\/users\/\d+$/, '/api/users/:id')
    .replace(/^\/api\/schedules\/\d+$/, '/api/schedules/:id')
    .replace(/^\/api\/classrooms\/[^/]+$/, '/api/classrooms/:id');
  return `${method} ${generic}`;
}

async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw requestError('Send request data as JSON.', 415);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw requestError('Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw requestError('Request body contains invalid JSON.', 400);
  }
}

function verifyPassword(password, saltHex, hashHex) {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createServer({
  database,
  root = path.join(__dirname, '..', 'public'),
  adminSignupKey = process.env.ROOMQ_ADMIN_SIGNUP_KEY
}) {
  // Failed sign-ins are tracked per client address + username, so repeated
  // failures lock out that account from that client only, not every user who
  // shares an address (e.g. behind Docker's port proxy or campus NAT).
  const failedLogins = new Map();
  const registrations = new Map();
  const resolvedRoot = path.resolve(root);
  const performance = createPerformanceMonitor(RESPONSE_TIME_TARGET_MS);

  function rateEntry(map, key) {
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
      map.set(key, entry);
    }
    return entry;
  }
  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const map of [failedLogins, registrations]) {
      for (const [key, entry] of map) {
        if (entry.resetAt <= now) map.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  pruneTimer.unref();

  async function getCurrentUser(request) {
    const token = getToken(request);
    return token ? database.findSession(hashToken(token)) : null;
  }

  // The single authorization gate for API routes: 401 when nobody is signed in,
  // 403 when the signed-in role lacks the permission.
  async function requirePermission(request, permission) {
    const user = await getCurrentUser(request);
    if (!user) {
      throw requestError('Sign in to continue.', 401);
    }
    if (!can(user, permission)) {
      throw requestError('Your account does not have permission to do this.', 403);
    }
    return user;
  }

  async function requireUser(request) {
    const user = await getCurrentUser(request);
    if (!user) {
      throw requestError('Sign in to continue.', 401);
    }
    return user;
  }

  async function createAuthenticatedSession(request, response, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await database.createSession(user.id, hashToken(token), Date.now() + SESSION_TTL_MS);
    const secure = isSecureRequest(request) ? '; Secure' : '';
    sendJson(response, 200, {
      authenticated: true,
      user: publicUser(user)
    }, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
    });
  }

  async function registerAccount(request, response, role) {
    const body = await readJson(request);
    // Only successful sign-ups count toward the limit, so typos and validation
    // errors do not lock other people out of creating accounts.
    const attempt = rateEntry(registrations, clientAddress(request));
    if (attempt.count >= MAX_REGISTRATIONS) {
      throw requestError('Too many accounts were created recently. Try again later.', 429);
    }

    if (role === 'admin') {
      if (typeof adminSignupKey !== 'string' || adminSignupKey.length < 16) {
        throw requestError('Admin sign-up is disabled. Configure ROOMQ_ADMIN_SIGNUP_KEY with at least 16 characters.', 503);
      }
      const providedKey = body && typeof body.setupKey === 'string' ? Buffer.from(body.setupKey) : Buffer.alloc(0);
      const expectedKey = Buffer.from(adminSignupKey);
      if (providedKey.length !== expectedKey.length ||
          !crypto.timingSafeEqual(providedKey, expectedKey)) {
        throw requestError('The administrator setup key is invalid.', 401);
      }
    }

    requireObject(body);
    const password = checkPassword(body.password);
    const firstName = checkNamePart(body.firstName, 'first name', true);
    const middleName = checkNamePart(body.middleName, 'middle name', false);
    const lastName = checkNamePart(body.lastName, 'last name', true);
    // Identity details: a school ID and an authorized university address.
    const email = checkUniversityEmail(body.email);
    const schoolId = checkSchoolId(body.schoolId, true);
    const user = await database.createUser({
      email, password, role, firstName, middleName, lastName, schoolId
    });
    if (!user) {
      throw requestError('That email address is already in use.', 409);
    }
    attempt.count += 1;
    await database.recordActivity(
      { id: user.id, email: user.email },
      'registered',
      'user',
      user.id,
      null,
      null,
      {
        firstName: user.first_name || null,
        middleName: user.middle_name || null,
        lastName: user.last_name || null,
        email: user.email,
        role: user.role
      }
    );
    await createAuthenticatedSession(request, response, user);
  }

  // Rules for reservations made by faculty accounts. Returns the sanitized
  // input to save. Administrators and staff are not subject to these limits.
  async function applyUserReservationPolicy(body, user, excludeId) {
    if (!body || body.kind !== 'reservation') {
      throw requestError('Your account can create room reservations only.', 403);
    }
    if (body.recurrence !== undefined && body.recurrence !== 'once') {
      throw requestError('Reservations must be for a single date.', 400);
    }
    const { date, startTime, endTime } = body;
    const now = localNow();
    if (isValidDate(date)) {
      if (date < now.date) {
        throw requestError('Choose today or a future date for the reservation.', 400);
      }
      if (date > addDays(now.date, RESERVATION_HORIZON_DAYS)) {
        throw requestError(`Reservations can be made up to ${RESERVATION_HORIZON_DAYS} days ahead.`, 400);
      }
      if (date === now.date && isValidTime(startTime) && startTime < now.time) {
        throw requestError('Choose a start time that has not already passed.', 400);
      }
    }
    if (isValidTime(startTime) && isValidTime(endTime) && startTime < endTime &&
        toMinutes(endTime) - toMinutes(startTime) > RESERVATION_MAX_MINUTES) {
      throw requestError(`A reservation can be at most ${RESERVATION_MAX_MINUTES / 60} hours long.`, 400);
    }
    if (await database.countActiveReservations(user.id, now.date, excludeId || null) >= RESERVATION_MAX_ACTIVE) {
      throw requestError(`You can hold at most ${RESERVATION_MAX_ACTIVE} upcoming reservations. Cancel one to book another.`, 409);
    }
    // Users choose only the room and the time; course, section and instructor
    // are class-schedule fields managed by administrators.
    return {
      kind: 'reservation',
      recurrence: 'once',
      classroomId: body.classroomId,
      date,
      startTime,
      endTime
    };
  }

  async function requireReservationOwner(user, id) {
    const existing = await database.getSchedule(id);
    if (!existing) {
      throw requestError('Schedule not found.', 404);
    }
    if (existing.kind !== 'reservation' || existing.createdByUserId !== user.id) {
      throw requestError('You can only change your own reservations.', 403);
    }
    return existing;
  }

  async function serveStatic(request, response, url) {
    const pathname = url.pathname;
    if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html') {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/admin/dashboard.html${url.search}`
      });
      response.end();
      return;
    }
    if (pathname === '/user' || pathname === '/user/' || pathname === '/user/index.html') {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/user/dashboard.html${url.search}`
      });
      response.end();
      return;
    }
    for (const prefix of ['/client/', '/users/']) {
      if (pathname.startsWith(prefix)) {
        const subpath = pathname.slice(prefix.length);
        const target = subpath && subpath !== 'index.html' ? subpath : 'dashboard.html';
        response.writeHead(302, {
          'Cache-Control': 'no-store',
          Location: `/user/${target}${url.search}`
        });
        response.end();
        return;
      }
    }
    if (pathname === '/client' || pathname === '/users') {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/user/dashboard.html${url.search}`
      });
      response.end();
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      // The site's front door: guests are sent to sign in; signed-in visitors
      // go to the portal that matches their role.
      const user = await getCurrentUser(request);
      const destination = !user
        ? '/user/login.html'
        : user.role === 'admin'
          ? '/admin/dashboard.html'
          : user.role === 'staff' ? '/staff/dashboard.html' : '/user/dashboard.html';
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: user ? `${destination}${url.search}` : destination
      });
      response.end();
      return;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      sendJson(response, 400, { error: 'Invalid URL path.' });
      return;
    }

    const legacyPath = decodedPath.replace(/^\/+/, '');
    const adminPages = new Set([
      'dashboard.html', 'schedules.html', 'assignments.html',
      'conflicts.html', 'reports.html', 'activity-logs.html'
    ]);
    const userPages = new Set(['classrooms.html', 'login.html']);
    if (legacyPath === 'index.html' || legacyPath === 'admin/index.html') {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/admin/dashboard.html${url.search}`
      });
      response.end();
      return;
    }
    if (legacyPath === 'user/index.html') {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/user/dashboard.html${url.search}`
      });
      response.end();
      return;
    }
    if (adminPages.has(legacyPath)) {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/admin/${legacyPath}${url.search}`
      });
      response.end();
      return;
    }
    if (userPages.has(legacyPath)) {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/user/${legacyPath}${url.search}`
      });
      response.end();
      return;
    }
    const pageScriptMap = {
      'dashboard.js': 'admin/js/dashboard.js',
      'schedules.js': 'admin/js/schedules.js',
      'assignments.js': 'admin/js/assignments.js',
      'conflicts.js': 'admin/js/conflicts.js',
      'reports.js': 'admin/js/reports.js',
      'activity-logs.js': 'admin/js/activity-logs.js',
      'classroom-explorer.js': 'user/js/classroom-explorer.js',
      'admin/js/classroom-explorer.js': 'user/js/classroom-explorer.js',
      'login.js': 'user/js/login.js'
    };
    const sharedScriptMap = {
      'script.js': 'shared/js/script.js',
      'roomq-time.js': 'shared/js/roomq-time.js',
      'roomq-data.js': 'shared/js/roomq-data.js',
      'roomq-api.js': 'shared/js/roomq-api.js'
    };
    const redirectTo = (location) => {
      response.writeHead(302, { 'Cache-Control': 'no-store', Location: location });
      response.end();
    };
    const signInLocation =
      `/user/login.html?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
    let pageAuthorized = false;

    if (legacyPath === 'staff' || legacyPath === 'staff/') {
      redirectTo(`/staff/dashboard.html${url.search}`);
      return;
    }
    // Staff portal pages. The staff-only pages live in public/staff; schedules,
    // conflicts and classrooms are the existing admin pages, served here so the
    // markup is not duplicated (the API enforces what each role may do in them).
    const staffPage = /^staff\/([A-Za-z0-9-]+\.html)$/.exec(legacyPath);
    if (staffPage) {
      const name = staffPage[1];
      const user = await getCurrentUser(request);
      if (!user) {
        redirectTo(signInLocation);
        return;
      }
      if (!can(user, PERMISSIONS.PORTAL_STAFF)) {
        redirectTo('/user/dashboard.html?denied=staff');
        return;
      }
      const adminCounterpart = fs.existsSync(path.join(resolvedRoot, 'admin', name));
      if (user.role === 'admin' && name !== 'account.html') {
        // Administrators work in the administrator portal.
        redirectTo(adminCounterpart ? `/admin/${name}${url.search}` : '/admin/dashboard.html');
        return;
      }
      if (!STAFF_OWN_PAGES.has(name) && !STAFF_SHARED_PAGES.has(name)) {
        if (adminCounterpart) {
          redirectTo('/staff/dashboard.html?denied=admin');
          return;
        }
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      pageAuthorized = true;
    }

    let relativePath = legacyPath;
    if (staffPage) {
      relativePath = STAFF_SHARED_PAGES.has(staffPage[1]) ? `admin/${staffPage[1]}` : legacyPath;
    } else if (/^staff\/js\/[A-Za-z0-9-]+\.js$/.test(legacyPath) &&
               STAFF_SHARED_SCRIPTS.has(legacyPath.slice('staff/js/'.length))) {
      relativePath = `admin/js/${legacyPath.slice('staff/js/'.length)}`;
    } else if (legacyPath.startsWith('user/')) {
      relativePath = legacyPath;
    } else if (pageScriptMap[legacyPath]) {
      relativePath = pageScriptMap[legacyPath];
    } else if (sharedScriptMap[legacyPath]) {
      relativePath = sharedScriptMap[legacyPath];
    } else if (legacyPath === 'style.css' || legacyPath === 'css/style.css') {
      relativePath = 'user/css/style.css';
    }
    const filePath = path.resolve(resolvedRoot, relativePath);
    if (!filePath.startsWith(`${resolvedRoot}${path.sep}`) &&
        filePath !== path.join(resolvedRoot, 'index.html')) {
      sendJson(response, 403, { error: 'Access denied.' });
      return;
    }
    if (filePath.includes(`${path.sep}node_modules${path.sep}`) ||
        /\.(?:sqlite(?:-(?:shm|wal))?|db|env)$/i.test(filePath) ||
        path.basename(filePath).startsWith('.')) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    // Administrator portal pages are only served to accounts with the admin
    // portal permission. Their scripts and styles stay public; the data behind
    // them is protected by the API. (Pages already authorized above for the
    // staff portal are the same files, served under /staff/.)
    if (!pageAuthorized &&
        filePath.startsWith(path.join(resolvedRoot, 'admin') + path.sep) &&
        path.extname(filePath).toLowerCase() === '.html') {
      const user = await getCurrentUser(request);
      if (!can(user, PERMISSIONS.PORTAL_ADMIN)) {
        redirectTo(!user
          ? signInLocation
          : user.role === 'staff' ? '/staff/dashboard.html?denied=admin' : '/user/dashboard.html?denied=admin');
        return;
      }
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()];
      if (!contentType) {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });
      fs.createReadStream(filePath).pipe(response);
    });
  }

  async function handleApi(request, response, url) {
    const { pathname, searchParams } = url;
    const method = request.method;

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    // Measured response times for core operations against the project's
    // two-second target. Part of the reports an administrator can review.
    if (pathname === '/api/performance' && method === 'GET') {
      await requirePermission(request, PERMISSIONS.REPORTS_VIEW);
      sendJson(response, 200, performance.snapshot());
      return;
    }
    if (pathname === '/api/me' && method === 'GET') {
      const user = await getCurrentUser(request);
      sendJson(response, 200, {
        authenticated: Boolean(user),
        user: user ? publicUser(user) : null
      });
      return;
    }
    if (pathname === '/api/register' && method === 'POST') {
      // Self-registration always creates a student. An administrator promotes
      // an account to faculty or staff after verifying who they are.
      await registerAccount(request, response, 'student');
      return;
    }
    if (pathname === '/api/register-admin' && method === 'POST') {
      await registerAccount(request, response, 'admin');
      return;
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJson(request);
      const rawIdentifier = body && typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : '';
      const password = body && typeof body.password === 'string' ? body.password : '';
      const limitKey = `${clientAddress(request)}|${rawIdentifier}`;
      const attempt = rateEntry(failedLogins, limitKey);
      if (attempt.count >= MAX_FAILED_LOGINS) {
        throw requestError('Too many sign-in attempts for this account. Try again later.', 429);
      }
      const role = body && body.role;
      if (role !== undefined && !ROLES.includes(role)) {
        throw requestError('Choose an administrator, staff or user account.', 400);
      }
      const user = await database.getUserByEmail(rawIdentifier);
      if (!user || (role && user.role !== role) ||
          !verifyPassword(password, user.password_salt, user.password_hash)) {
        attempt.count += 1;
        throw requestError('Email or password is incorrect.', 401);
      }
      // Checked only after the password is verified, so a wrong guess cannot
      // be used to discover which usernames belong to deactivated accounts.
      if (!user.is_active) {
        throw requestError('This account has been deactivated. Contact an administrator.', 403);
      }
      failedLogins.delete(limitKey);
      await database.recordActivity(
        { id: user.id, email: user.email },
        'signed_in',
        'session',
        null,
        null,
        null,
        { role: user.role }
      );
      await createAuthenticatedSession(request, response, user);
      return;
    }
    if (pathname === '/api/logout' && method === 'POST') {
      const token = getToken(request);
      if (token) {
        const user = await getCurrentUser(request);
        if (user) {
          await database.recordActivity(
            { id: user.id, email: user.email },
            'signed_out',
            'session',
            null,
            null,
            { role: user.role },
            null
          );
        }
        await database.deleteSession(hashToken(token));
      }
      sendJson(response, 200, { authenticated: false }, {
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
      });
      return;
    }
    if (pathname === '/api/buildings' && method === 'GET') {
      sendJson(response, 200, await database.listBuildings());
      return;
    }
    if (pathname === '/api/classrooms' && method === 'GET') {
      sendJson(response, 200, await database.listClassrooms({
        buildingId: searchParams.get('buildingId') || undefined,
        floorId: searchParams.get('floorId') || undefined
      }));
      return;
    }
    if (pathname === '/api/availability' && method === 'GET') {
      const viewer = await getCurrentUser(request);
      const rooms = await database.getAvailability({
        date: searchParams.get('date'),
        startTime: searchParams.get('startTime'),
        endTime: searchParams.get('endTime'),
        buildingId: searchParams.get('buildingId') || undefined,
        floorId: searchParams.get('floorId') || undefined
      });
      sendJson(response, 200, rooms.map((room) => ({
        ...room,
        schedules: room.schedules.map((schedule) => presentSchedule(schedule, viewer))
      })));
      return;
    }
    if (pathname === '/api/dashboard' && method === 'GET') {
      sendJson(response, 200, await database.getDashboard(searchParams.get('date') || undefined));
      return;
    }
    if (pathname === '/api/schedules' && method === 'GET') {
      const viewer = await getCurrentUser(request);
      const schedules = await database.listSchedules({
        kind: searchParams.get('kind') || undefined,
        buildingId: searchParams.get('buildingId') || undefined,
        floorId: searchParams.get('floorId') || undefined,
        classroomId: searchParams.get('classroomId') || undefined
      });
      sendJson(response, 200, schedules.map((schedule) => presentSchedule(schedule, viewer)));
      return;
    }
    if (pathname === '/api/my/reservations' && method === 'GET') {
      const user = await getCurrentUser(request);
      if (!user) {
        throw requestError('Sign in to view your reservations.', 401);
      }
      const reservations = await database.listSchedules({
        kind: 'reservation',
        createdByUserId: user.id
      });
      sendJson(response, 200, reservations.map((schedule) => presentSchedule(schedule, user)));
      return;
    }
    if (pathname === '/api/reports' && method === 'GET') {
      await requirePermission(request, PERMISSIONS.REPORTS_VIEW);
      const [classrooms, schedules, conflicts] = await Promise.all([
        database.listClassrooms(),
        database.listSchedules(),
        database.getConflicts()
      ]);
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        classrooms,
        schedules,
        conflicts
      });
      return;
    }
    if (pathname === '/api/activity-logs' && method === 'GET') {
      await requirePermission(request, PERMISSIONS.ACTIVITY_VIEW);
      const startDate = searchParams.get('startDate') || undefined;
      const endDate = searchParams.get('endDate') || undefined;
      const action = searchParams.get('action') || undefined;
      const allowedActions = new Set([
        'created', 'updated', 'deleted', 'registered', 'signed_in', 'signed_out'
      ]);
      if ((startDate && !isValidDate(startDate)) ||
          (endDate && !isValidDate(endDate)) ||
          (startDate && endDate && startDate > endDate)) {
        throw requestError('Choose a valid activity log date range.', 400);
      }
      if (action && !allowedActions.has(action)) {
        throw requestError('Choose a valid activity type.', 400);
      }
      const timezoneOffsetValue = searchParams.get('timezoneOffset');
      const timezoneOffset = timezoneOffsetValue === null ? 0 : Number(timezoneOffsetValue);
      if (!Number.isSafeInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840) {
        throw requestError('Activity log timezone offset is invalid.', 400);
      }
      const toTimestamp = (date, dayOffset = 0) => {
        const timestamp = Date.parse(`${date}T00:00:00Z`) +
          (timezoneOffset + dayOffset * 1440) * 60000;
        return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
      };
      const limitValue = searchParams.get('limit');
      const offsetValue = searchParams.get('offset');
      const limit = limitValue === null ? 100 : Number(limitValue);
      const offset = offsetValue === null ? 0 : Number(offsetValue);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
          !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
        throw requestError('Activity log pagination values are invalid.', 400);
      }
      const logs = await database.listActivityLogs({
        startAt: startDate ? toTimestamp(startDate) : undefined,
        endAtExclusive: endDate ? toTimestamp(endDate, 1) : undefined,
        action,
        limit: limit + 1,
        offset
      });
      sendJson(response, 200, {
        items: logs.slice(0, limit),
        hasMore: logs.length > limit
      });
      return;
    }
    if (pathname === '/api/schedules' && method === 'POST') {
      const user = await getCurrentUser(request);
      if (!user) {
        throw requestError('Sign in before creating a schedule or room reservation.', 401);
      }
      let body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw requestError('Provide schedule details.', 400);
      }
      // Administrators and staff may add class schedules and reservations;
      // faculty may reserve rooms under the booking rules; students may not
      // book at all.
      if (!can(user, PERMISSIONS.SCHEDULES_CREATE)) {
        if (!can(user, PERMISSIONS.RESERVATIONS_CREATE)) {
          throw requestError(
            'Student accounts can view classrooms and schedules but cannot reserve rooms.',
            403
          );
        }
        body = await applyUserReservationPolicy(body, user, null);
      }
      const schedule = await database.saveSchedule(body, undefined, user);
      sendJson(response, 201, presentSchedule(schedule, user));
      return;
    }
    if (pathname.startsWith('/api/schedules/') && (method === 'PUT' || method === 'DELETE')) {
      const user = await getCurrentUser(request);
      if (!user) {
        throw requestError('Sign in to change schedules or reservations.', 401);
      }
      const id = Number(pathname.slice('/api/schedules/'.length));
      if (!Number.isSafeInteger(id) || id < 1) {
        throw requestError('Schedule ID is invalid.', 400);
      }
      // Whoever holds the update/delete permission may change any schedule;
      // everyone else may only change reservations they made themselves.
      const needed = method === 'PUT' ? PERMISSIONS.SCHEDULES_UPDATE : PERMISSIONS.SCHEDULES_DELETE;
      const ownReservationOnly = !can(user, needed);
      if (ownReservationOnly) {
        if (!can(user, PERMISSIONS.RESERVATIONS_CREATE)) {
          throw requestError(
            'Student accounts can view classrooms and schedules but cannot change bookings.',
            403
          );
        }
        await requireReservationOwner(user, id);
      }
      if (method === 'PUT') {
        let body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw requestError('Provide schedule details.', 400);
        }
        if (ownReservationOnly) {
          body = await applyUserReservationPolicy(body, user, id);
        }
        const schedule = await database.saveSchedule(body, id, user);
        sendJson(response, 200, presentSchedule(schedule, user));
        return;
      }
      if (!await database.deleteSchedule(id, user)) {
        throw requestError('Schedule not found.', 404);
      }
      sendJson(response, 200, { deleted: true });
      return;
    }
    // Classroom records: administrators maintain seating capacity and the
    // facilities a room offers, which are what the availability filters use.
    const classroomRoute = /^\/api\/classrooms\/([A-Za-z0-9-]{1,128})$/.exec(pathname);
    if (classroomRoute && method === 'PUT') {
      const actor = await requirePermission(request, PERMISSIONS.CLASSROOMS_MANAGE);
      const body = requireObject(await readJson(request));
      const changes = {};
      if (body.capacity !== undefined) {
        if (body.capacity === null || body.capacity === '') {
          changes.capacity = null;
        } else {
          const capacity = Number(body.capacity);
          if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2000) {
            throw requestError('Capacity must be a whole number between 1 and 2000.', 400);
          }
          changes.capacity = capacity;
        }
      }
      if (body.facilities !== undefined) {
        if (!Array.isArray(body.facilities)) {
          throw requestError('Facilities must be a list.', 400);
        }
        const facilities = [...new Set(body.facilities
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean))];
        if (facilities.length > 20 || facilities.some((item) => item.length > 60)) {
          throw requestError('Use at most 20 facilities, each 60 characters or fewer.', 400);
        }
        if (JSON.stringify(facilities).length > 2000) {
          throw requestError('That facility list is too long.', 400);
        }
        changes.facilities = facilities;
      }
      if (!Object.keys(changes).length) {
        throw requestError('Provide a capacity or facility list to update.', 400);
      }
      sendJson(response, 200, await database.updateClassroom(classroomRoute[1], changes, actor));
      return;
    }
    if (pathname === '/api/conflicts' && method === 'GET') {
      await requirePermission(request, PERMISSIONS.CONFLICTS_VIEW);
      sendJson(response, 200, await database.getConflicts({
        buildingId: searchParams.get('buildingId') || undefined,
        classroomId: searchParams.get('classroomId') || undefined,
        date: searchParams.get('date') || undefined
      }));
      return;
    }

    // ---- Own account (any signed-in role) --------------------------------
    if (pathname === '/api/account' && method === 'GET') {
      const user = await requireUser(request);
      sendJson(response, 200, {
        ...await database.getUserById(user.id),
        permissions: permissionsFor(user.role)
      });
      return;
    }
    if (pathname === '/api/account' && method === 'PUT') {
      const user = await requireUser(request);
      const body = requireObject(await readJson(request));
      // Role, status and school ID are never editable from a profile request,
      // whatever the client sends: they are identity and authorization data
      // that only an administrator may set.
      if ('role' in body || 'isActive' in body || 'permissions' in body) {
        throw requestError('You cannot change your own role or account status.', 403);
      }
      if ('schoolId' in body) {
        throw requestError('Ask an administrator to correct your school ID.', 403);
      }
      const current = await database.getUserById(user.id);
      const firstName = checkNamePart(body.firstName, 'first name', false);
      const middleName = checkNamePart(body.middleName, 'middle name', false);
      const lastName = checkNamePart(body.lastName, 'last name', false);
      const fullName = checkFullName(body.fullName);
      const email = checkEmail(body.email);
      if (email === null) {
        throw requestError('Enter a valid email address.', 400);
      }
      if (firstName === undefined && middleName === undefined && lastName === undefined &&
          fullName === undefined && email === undefined) {
        throw requestError('Provide a name or email address to update.', 400);
      }
      const updated = await database.updateOwnProfile(user.id, {
        firstName,
        middleName,
        lastName,
        fullName: fullName === undefined ? current.fullName : fullName,
        email: email === undefined ? current.email : email
      });
      sendJson(response, 200, { ...updated, permissions: permissionsFor(user.role) });
      return;
    }
    if (pathname === '/api/account/password' && method === 'POST') {
      const user = await requireUser(request);
      const body = requireObject(await readJson(request));
      const attempt = rateEntry(failedLogins, `password|${user.id}`);
      if (attempt.count >= MAX_FAILED_LOGINS) {
        throw requestError('Too many incorrect password attempts. Try again later.', 429);
      }
      const record = await database.getUserByEmail(user.email);
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!record || !verifyPassword(currentPassword, record.password_salt, record.password_hash)) {
        attempt.count += 1;
        throw requestError('Your current password is incorrect.', 403);
      }
      const newPassword = checkPassword(body.newPassword);
      if (newPassword === currentPassword) {
        throw requestError('Choose a new password that is different from the current one.', 400);
      }
      failedLogins.delete(`password|${user.id}`);
      await database.changePassword(user.id, newPassword, hashToken(getToken(request)));
      sendJson(response, 200, { changed: true });
      return;
    }

    // ---- User management (administrators) --------------------------------
    if (pathname === '/api/users' && method === 'GET') {
      await requirePermission(request, PERMISSIONS.USERS_MANAGE);
      const role = searchParams.get('role') || undefined;
      const status = searchParams.get('status') || undefined;
      if (role) checkRole(role);
      if (status && !['active', 'inactive'].includes(status)) {
        throw requestError('Status must be active or inactive.', 400);
      }
      const q = (searchParams.get('q') || '').trim().slice(0, 100) || undefined;
      sendJson(response, 200, await database.listUsers({ q, role, status }));
      return;
    }
    if (pathname === '/api/users' && method === 'POST') {
      const actor = await requirePermission(request, PERMISSIONS.USERS_MANAGE);
      const body = requireObject(await readJson(request));
      const password = checkPassword(body.password);
      const role = body.role === undefined ? 'staff' : checkRole(body.role);
      const firstName = checkNamePart(body.firstName, 'first name', true);
      const middleName = checkNamePart(body.middleName, 'middle name', false);
      const lastName = checkNamePart(body.lastName, 'last name', true);
      const email = checkRequiredEmail(body.email);
      const schoolId = checkSchoolId(body.schoolId, false);
      const isActive = checkBoolean(body.isActive, 'Active');
      const created = await database.createUser({
        email, password, role, firstName, middleName, lastName, schoolId, isActive
      });
      if (!created) {
        throw requestError('That email address is already in use.', 409);
      }
      const account = await database.getUserById(created.id);
      await database.recordActivity(
        actor, 'created', 'user', account.id, null, null,
        {
          firstName: account.firstName,
          middleName: account.middleName,
          lastName: account.lastName,
          fullName: account.fullName,
          email: account.email,
          role: account.role,
          isActive: account.isActive
        }
      );
      sendJson(response, 201, account);
      return;
    }
    const userRoute = /^\/api\/users\/(\d{1,10})$/.exec(pathname);
    if (userRoute) {
      const actor = await requirePermission(request, PERMISSIONS.USERS_MANAGE);
      const id = Number(userRoute[1]);
      if (id < 1) {
        throw requestError('User ID is invalid.', 400);
      }
      if (method === 'GET') {
        const account = await database.getUserById(id);
        if (!account) {
          throw requestError('User not found.', 404);
        }
        sendJson(response, 200, account);
        return;
      }
      if (method === 'PUT') {
        const body = requireObject(await readJson(request));
        const changes = {};
        if (body.firstName !== undefined) changes.firstName = checkNamePart(body.firstName, 'first name', false);
        if (body.middleName !== undefined) changes.middleName = checkNamePart(body.middleName, 'middle name', false);
        if (body.lastName !== undefined) changes.lastName = checkNamePart(body.lastName, 'last name', false);
        if (body.fullName !== undefined) changes.fullName = checkFullName(body.fullName);
        if (body.email !== undefined) changes.email = checkEmail(body.email);
        if (body.schoolId !== undefined) changes.schoolId = checkSchoolId(body.schoolId, false);
        if (body.role !== undefined) changes.role = checkRole(body.role);
        if (body.isActive !== undefined) changes.isActive = checkBoolean(body.isActive, 'Active');
        if (body.password !== undefined && body.password !== '') {
          changes.password = checkPassword(body.password);
        }
        if (!Object.keys(changes).length) {
          throw requestError('Provide at least one account detail to update.', 400);
        }
        sendJson(response, 200, await database.updateUser(id, changes, actor));
        return;
      }
      if (method === 'DELETE') {
        if (id === actor.id) {
          throw requestError('You cannot delete your own account. Ask another administrator to do it.', 409);
        }
        await database.deleteUser(id, actor);
        sendJson(response, 200, { deleted: true });
        return;
      }
    }

    throw requestError('API endpoint not found.', 404);
  }

  function handleError(response, error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error('RoomQ request failed.', error);
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    const payload = { error: status >= 500 ? 'The server could not complete the request.' : error.message };
    if (error.code === 'schedule_conflict') {
      payload.code = error.code;
      payload.conflict = {
        ...error.conflict,
        existingSchedule: presentSchedule(error.conflict.existingSchedule, null)
      };
    }
    sendJson(response, status, payload);
  }

  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
        return;
      }
      serveStatic(request, response, url).catch((error) => handleError(response, error));
      return;
    }

    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      performance.record(
        routeLabel(request.method, url.pathname),
        Number(process.hrtime.bigint() - startedAt) / 1e6
      );
    });
    handleApi(request, response, url).catch((error) => handleError(response, error));
  });
}

if (require.main === module) {
  (async () => {
    let database;
    let server;
    try {
      database = await createDatabase();
      server = createServer({ database });
      const port = Number(process.env.PORT) || 3000;
      const host = process.env.HOST || '127.0.0.1';
      server.listen(port, host, () => {
        console.log(`RoomQ is available at http://localhost:${port}`);
      });
      const shutdown = () => {
        server.close(async () => {
          await database.close();
          process.exit(0);
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      console.error(error.message);
      if (database) {
        await database.close();
      }
      process.exitCode = 1;
    }
  })();
}

module.exports = { createServer };
