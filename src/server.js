const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDatabase } = require('./roomq-db');
const { isValidDate } = require('./schedule-rules');

const SESSION_COOKIE = 'roomq_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
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
  const failedLogins = new Map();
  const registrations = new Map();
  const resolvedRoot = path.resolve(root);

  function getCurrentUser(request) {
    const token = getToken(request);
    return token ? database.findSession(hashToken(token)) : null;
  }

  function requireAdmin(request) {
    const user = getCurrentUser(request);
    if (!user) {
      throw requestError('Sign in with an administrator account to manage schedules.', 401);
    }
    if (user.role !== 'admin') {
      throw requestError('Only administrators can manage schedules.', 403);
    }
    return user;
  }

  function createAuthenticatedSession(response, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    database.createSession(user.id, hashToken(token), Date.now() + SESSION_TTL_MS);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    sendJson(response, 200, {
      authenticated: true,
      user: { username: user.username, role: user.role }
    }, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
    });
  }

  async function registerAccount(request, response, role) {
    const body = await readJson(request);
    const address = request.socket.remoteAddress || 'unknown';
    const attempt = registrations.get(address) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (attempt.resetAt <= Date.now()) {
      attempt.count = 0;
      attempt.resetAt = Date.now() + 15 * 60 * 1000;
    }
    if (attempt.count >= 5) {
      throw requestError('Too many account creation attempts. Try again later.', 429);
    }
    attempt.count += 1;
    registrations.set(address, attempt);

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

    const username = body && typeof body.username === 'string' ? body.username.trim() : '';
    const password = body && typeof body.password === 'string' ? body.password : '';
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      throw requestError('Username must be 3-32 characters using letters, numbers, dots, underscores, or hyphens.', 400);
    }
    if (password.length < 12 || password.length > 128) {
      throw requestError('Password must be between 12 and 128 characters.', 400);
    }
    const user = database.createUser(username, password, role);
    if (!user) {
      throw requestError('That username is already in use.', 409);
    }
    database.recordActivity(
      { id: user.id, username: user.username },
      'registered',
      'user',
      user.id,
      null,
      null,
      { username: user.username, role: user.role }
    );
    createAuthenticatedSession(response, user);
  }

  function serveStatic(request, response, url) {
    const pathname = url.pathname;
    for (const prefix of ['/client/', '/users/']) {
      if (pathname.startsWith(prefix)) {
        response.writeHead(302, {
          'Cache-Control': 'no-store',
          Location: `/user/${pathname.slice(prefix.length)}${url.search}`
        });
        response.end();
        return;
      }
    }
    if (pathname === '/') {
      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: `/admin/dashboard.html${url.search}`
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
      'login.js': 'user/js/login.js'
    };
    const sharedScriptMap = {
      'script.js': 'shared/js/script.js',
      'roomq-time.js': 'shared/js/roomq-time.js',
      'roomq-data.js': 'shared/js/roomq-data.js',
      'roomq-api.js': 'shared/js/roomq-api.js'
    };
    let relativePath = legacyPath;
    if (legacyPath.startsWith('user/')) {
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
    if (pathname === '/api/me' && method === 'GET') {
      const user = getCurrentUser(request);
      sendJson(response, 200, {
        authenticated: Boolean(user),
        user: user ? { username: user.username, role: user.role } : null
      });
      return;
    }
    if (pathname === '/api/register' && method === 'POST') {
      await registerAccount(request, response, 'user');
      return;
    }
    if (pathname === '/api/register-admin' && method === 'POST') {
      await registerAccount(request, response, 'admin');
      return;
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJson(request);
      const address = request.socket.remoteAddress || 'unknown';
      const attempt = failedLogins.get(address) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
      if (attempt.resetAt <= Date.now()) {
        attempt.count = 0;
        attempt.resetAt = Date.now() + 15 * 60 * 1000;
      }
      if (attempt.count >= 10) {
        throw requestError('Too many sign-in attempts. Try again later.', 429);
      }
      const username = body && typeof body.username === 'string' ? body.username.trim() : '';
      const password = body && typeof body.password === 'string' ? body.password : '';
      const role = body && body.role;
      if (role !== undefined && !['admin', 'user'].includes(role)) {
        throw requestError('Choose an administrator or user account.', 400);
      }
      const user = database.getUser(username);
      if (!user || (role && user.role !== role) ||
          !verifyPassword(password, user.password_salt, user.password_hash)) {
        attempt.count += 1;
        failedLogins.set(address, attempt);
        throw requestError('Username or password is incorrect.', 401);
      }
      failedLogins.delete(address);
      database.recordActivity(
        { id: user.id, username: user.username },
        'signed_in',
        'session',
        null,
        null,
        null,
        { role: user.role }
      );
      createAuthenticatedSession(response, user);
      return;
    }
    if (pathname === '/api/logout' && method === 'POST') {
      const token = getToken(request);
      if (token) {
        const user = getCurrentUser(request);
        if (user) {
          database.recordActivity(
            { id: user.id, username: user.username },
            'signed_out',
            'session',
            null,
            null,
            { role: user.role },
            null
          );
        }
        database.deleteSession(hashToken(token));
      }
      sendJson(response, 200, { authenticated: false }, {
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
      });
      return;
    }
    if (pathname === '/api/buildings' && method === 'GET') {
      sendJson(response, 200, database.listBuildings());
      return;
    }
    if (pathname === '/api/classrooms' && method === 'GET') {
      sendJson(response, 200, database.listClassrooms({
        buildingId: searchParams.get('buildingId') || undefined,
        floorId: searchParams.get('floorId') || undefined
      }));
      return;
    }
    if (pathname === '/api/availability' && method === 'GET') {
      sendJson(response, 200, database.getAvailability({
        date: searchParams.get('date'),
        startTime: searchParams.get('startTime'),
        endTime: searchParams.get('endTime'),
        buildingId: searchParams.get('buildingId') || undefined,
        floorId: searchParams.get('floorId') || undefined
      }));
      return;
    }
    if (pathname === '/api/dashboard' && method === 'GET') {
      sendJson(response, 200, database.getDashboard(searchParams.get('date') || undefined));
      return;
    }
    if (pathname === '/api/schedules' && method === 'GET') {
      sendJson(response, 200, database.listSchedules({
        kind: searchParams.get('kind') || undefined,
        buildingId: searchParams.get('buildingId') || undefined,
        floorId: searchParams.get('floorId') || undefined,
        classroomId: searchParams.get('classroomId') || undefined
      }));
      return;
    }
    if (pathname === '/api/reports' && method === 'GET') {
      requireAdmin(request);
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        classrooms: database.listClassrooms(),
        schedules: database.listSchedules(),
        conflicts: database.getConflicts()
      });
      return;
    }
    if (pathname === '/api/activity-logs' && method === 'GET') {
      requireAdmin(request);
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
      const toSqliteTimestamp = (date, dayOffset = 0) => {
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
      const logs = database.listActivityLogs({
        startAt: startDate ? toSqliteTimestamp(startDate) : undefined,
        endAtExclusive: endDate ? toSqliteTimestamp(endDate, 1) : undefined,
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
      const user = getCurrentUser(request);
      if (!user) {
        throw requestError('Sign in before creating a schedule or room reservation.', 401);
      }
      const body = await readJson(request);
      if (user.role !== 'admin' && !(user.role === 'user' && body.kind === 'reservation')) {
        throw requestError('User accounts can create room reservations only.', 403);
      }
      const schedule = database.saveSchedule(body, undefined, user);
      sendJson(response, 201, schedule);
      return;
    }
    if (pathname.startsWith('/api/schedules/')) {
      const user = requireAdmin(request);
      const id = Number(pathname.slice('/api/schedules/'.length));
      if (!Number.isSafeInteger(id) || id < 1) {
        throw requestError('Schedule ID is invalid.', 400);
      }
      if (method === 'PUT') {
        const schedule = database.saveSchedule(await readJson(request), id, user);
        sendJson(response, 200, schedule);
        return;
      }
      if (method === 'DELETE') {
        if (!database.deleteSchedule(id, user)) {
          throw requestError('Schedule not found.', 404);
        }
        sendJson(response, 200, { deleted: true });
        return;
      }
    }
    if (pathname === '/api/conflicts' && method === 'GET') {
      requireAdmin(request);
      sendJson(response, 200, database.getConflicts({
        buildingId: searchParams.get('buildingId') || undefined,
        classroomId: searchParams.get('classroomId') || undefined,
        date: searchParams.get('date') || undefined
      }));
      return;
    }

    throw requestError('API endpoint not found.', 404);
  }

  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
        return;
      }
      serveStatic(request, response, url);
      return;
    }

    handleApi(request, response, url).catch((error) => {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) {
        console.error('RoomQ API request failed.', error);
      }
      const payload = { error: status >= 500 ? 'The server could not complete the request.' : error.message };
      if (error.code === 'schedule_conflict') {
        payload.code = error.code;
        payload.conflict = error.conflict;
      }
      sendJson(response, status, payload);
    });
  });
}

if (require.main === module) {
  let database;
  let server;
  try {
    database = createDatabase(process.env.ROOMQ_DB_PATH || undefined);
    server = createServer({ database });
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => {
      console.log(`RoomQ is available at http://localhost:${port}`);
    });
    const shutdown = () => {
      server.close(() => {
        database.close();
        process.exit(0);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(error.message);
    if (database) {
      database.close();
    }
    process.exitCode = 1;
  }
}

module.exports = { createServer };
