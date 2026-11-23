const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const mysql = require('mysql2/promise');
const { createDatabase, readEnvConfig } = require('../src/roomq-db');
const { createServer } = require('../src/server');
const {
  appliesOnDate,
  findScheduleOverlap,
  validateScheduleInput
} = require('../src/schedule-rules');

// Each test runs against its own throwaway MySQL database so they stay
// isolated. Connection settings come from the same ROOMQ_DB_* environment
// variables the app uses; the account must be able to CREATE/DROP databases
// (e.g. point ROOMQ_DB_USER/PASSWORD at root, ROOMQ_DB_PORT at the host port
// mapped by docker compose). See README "Tests".
async function setupDatabase(t) {
  const base = readEnvConfig();
  const name = `roomq_test_${crypto.randomBytes(6).toString('hex')}`;
  const database = await createDatabase({
    database: name,
    adminUsername: 'admin',
    adminPassword: 'test-password-long-enough',
    connectAttempts: 10,
    connectDelayMs: 500
  });
  t.after(async () => {
    await database.close();
    const admin = await mysql.createConnection({
      host: base.host, port: base.port, user: base.user, password: base.password
    });
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.end();
  });
  return database;
}

async function startServer(t, options) {
  const database = await setupDatabase(t);
  const server = createServer({ database, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())));
  return { database, url: `http://127.0.0.1:${server.address().port}` };
}

// A local calendar date `days` from today (reservation rules reject past dates).
function futureDate(days = 7) {
  const date = new Date(Date.now() + days * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function loginCookie(url, username, password) {
  const response = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function registerCookie(url, username, password = `${username}-password-long`) {
  const response = await fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

function reservation(classroomId, overrides = {}) {
  return {
    kind: 'reservation',
    classroomId,
    recurrence: 'once',
    date: futureDate(),
    startTime: '13:00',
    endTime: '14:00',
    ...overrides
  };
}

function classSchedule(classroomId, overrides = {}) {
  return {
    kind: 'class',
    course: 'BIO 101',
    section: 'A',
    instructor: 'Instructor One',
    classroomId,
    recurrence: 'once',
    date: '2026-11-17',
    startTime: '08:00',
    endTime: '10:00',
    ...overrides
  };
}

test('schedule rules allow adjacent intervals and reject overlaps', () => {
  const existing = validateScheduleInput(classSchedule('cas-3-3-region-1'));
  const adjacent = validateScheduleInput(classSchedule('cas-3-3-region-1', {
    startTime: '10:00',
    endTime: '11:00'
  }));
  const overlapping = validateScheduleInput(classSchedule('cas-3-3-region-1', {
    startTime: '09:00',
    endTime: '11:00'
  }));

  assert.equal(findScheduleOverlap(existing, adjacent), null);
  assert.deepEqual(findScheduleOverlap(existing, overlapping), {
    date: '2026-11-17',
    startTime: '09:00',
    endTime: '10:00'
  });
});

test('weekly schedules apply only on configured weekdays and within their date range', () => {
  const weekly = validateScheduleInput(classSchedule('cas-3-3-region-1', {
    recurrence: 'weekly',
    date: undefined,
    daysOfWeek: [1, 3],
    startDate: '2026-11-16',
    endDate: '2026-12-31'
  }));

  assert.equal(appliesOnDate(weekly, '2026-11-16'), true);
  assert.equal(appliesOnDate(weekly, '2026-11-17'), false);
  assert.equal(appliesOnDate(weekly, '2027-01-04'), false);
});

test('database seeds only the existing mapped rooms and prevents double-booking', async (t) => {
  const database = await setupDatabase(t);
  const rooms = await database.listClassrooms({ buildingId: 'cas', floorId: '3' });

  assert.equal((await database.listBuildings()).length, 8);
  assert.equal(rooms.length, 11);
  assert.equal((await database.listClassrooms({ buildingId: 'law' })).length, 5);

  const classroomId = rooms[0].id;
  const first = await database.saveSchedule(classSchedule(classroomId));
  assert.equal(first.classroomId, classroomId);

  await assert.rejects(
    () => database.saveSchedule(classSchedule(classroomId, {
      startTime: '09:00',
      endTime: '11:00',
      course: 'BIO 102'
    })),
    (error) => error.status === 409 &&
      error.code === 'schedule_conflict' &&
      error.conflict.overlapPeriod.startTime === '09:00' &&
      error.conflict.overlapPeriod.endTime === '10:00'
  );

  const adjacent = await database.saveSchedule(classSchedule(classroomId, {
    startTime: '10:00',
    endTime: '11:00'
  }));
  assert.ok(adjacent.id > first.id);

  const availability = await database.getAvailability({
    date: '2026-11-17',
    startTime: '09:00',
    endTime: '09:30',
    buildingId: 'cas',
    floorId: '3'
  });
  assert.equal(availability.find((room) => room.id === classroomId).status, 'occupied');
  assert.equal(availability.filter((room) => room.status === 'available').length, 10);

  await database.saveSchedule({
    kind: 'reservation',
    classroomId,
    recurrence: 'once',
    date: '2026-11-17',
    startTime: '11:00',
    endTime: '12:00'
  });
  const reservedAvailability = await database.getAvailability({
    date: '2026-11-17',
    startTime: '11:15',
    endTime: '11:30',
    buildingId: 'cas',
    floorId: '3'
  });
  assert.equal(reservedAvailability.find((room) => room.id === classroomId).status, 'reserved');
});

test('availability rejects impossible calendar dates as client errors', async (t) => {
  const database = await setupDatabase(t);

  await assert.rejects(
    () => database.getAvailability({
      date: '2026-02-30',
      startTime: '09:00',
      endTime: '10:00'
    }),
    (error) => error.status === 400
  );
});

test('root sends guests to sign in and the sign-in page has no account-type switch', async (t) => {
  const { url } = await startServer(t);

  const root = await fetch(url, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/user/login.html');

  const legacyIndex = await fetch(`${url}/index.html`, { redirect: 'manual' });
  assert.equal(legacyIndex.status, 302);
  assert.equal(legacyIndex.headers.get('location'), '/user/login.html');

  const userCookie = await registerCookie(url, 'root-user');
  const userRoot = await fetch(url, { redirect: 'manual', headers: { Cookie: userCookie } });
  assert.equal(userRoot.headers.get('location'), '/user/dashboard.html');

  const legacyAdminDashboard = await fetch(`${url}/admin/index.html`, { redirect: 'manual' });
  assert.equal(legacyAdminDashboard.status, 302);
  assert.equal(legacyAdminDashboard.headers.get('location'), '/admin/dashboard.html');

  const adminCookie = await loginCookie(url, 'admin', 'test-password-long-enough');
  const adminRoot = await fetch(url, { redirect: 'manual', headers: { Cookie: adminCookie } });
  assert.equal(adminRoot.headers.get('location'), '/admin/dashboard.html');
  assert.equal((await fetch(`${url}/admin/dashboard.html`, { headers: { Cookie: adminCookie } })).status, 200);

  const legacyLogin = await fetch(`${url}/login.html?returnTo=%2Fuser%2Fclassrooms.html`, { redirect: 'manual' });
  assert.equal(legacyLogin.status, 302);
  assert.equal(legacyLogin.headers.get('location'), '/user/login.html?returnTo=%2Fuser%2Fclassrooms.html');

  const legacyClientUrl = await fetch(`${url}/client/login.html?from=old-link`, { redirect: 'manual' });
  assert.equal(legacyClientUrl.status, 302);
  assert.equal(legacyClientUrl.headers.get('location'), '/user/login.html?from=old-link');

  const legacyClassroomsUrl = await fetch(`${url}/client/classrooms.html`, { redirect: 'manual' });
  assert.equal(legacyClassroomsUrl.status, 302);
  assert.equal(legacyClassroomsUrl.headers.get('location'), '/user/classrooms.html');

  const legacyUsersUrl = await fetch(`${url}/users/login.html?from=old-link`, { redirect: 'manual' });
  assert.equal(legacyUsersUrl.status, 302);
  assert.equal(legacyUsersUrl.headers.get('location'), '/user/login.html?from=old-link');

  const loginPage = await fetch(`${url}/user/login.html`);
  assert.equal(loginPage.status, 200);
  assert.doesNotMatch(await loginPage.text(), /data-auth-role|auth-role-switch|adminSetupKey/);
  assert.equal((await fetch(`${url}/user/classrooms.html`)).status, 200);
  assert.equal((await fetch(`${url}/user/dashboard.html`)).status, 200);

  for (const asset of [
    'admin/css/style.css', 'user/css/style.css', 'css/style.css',
    'shared/js/roomq-api.js', 'admin/js/dashboard.js',
    'user/js/login.js', 'user/js/classroom-explorer.js'
  ]) {
    const response = await fetch(`${url}/${asset}`);
    assert.equal(response.status, 200);
  }
});

test('API protects schedule changes and returns conflicting schedule details', async (t) => {
  const { database, url } = await startServer(t);
  for (const script of ['admin/js/reports.js', 'admin/js/activity-logs.js']) {
    const response = await fetch(`${url}/${script}`);
    assert.equal(response.status, 200);
  }
  const room = (await database.listClassrooms({ buildingId: 'cas', floorId: '3' }))[0];
  const unauthenticated = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(classSchedule(room.id))
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await fetch(`${url}/api/reports`)).status, 401);
  assert.equal((await fetch(`${url}/api/activity-logs`)).status, 401);
  const invalidDate = await fetch(
    `${url}/api/availability?date=2026-02-30&startTime=09%3A00&endTime=10%3A00`
  );
  assert.equal(invalidDate.status, 400);

  const login = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password-long-enough' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const initialReports = await fetch(`${url}/api/reports`, {
    headers: { Cookie: cookie }
  });
  assert.equal(initialReports.status, 200);
  assert.equal((await initialReports.json()).classrooms.length, (await database.listClassrooms()).length);

  const created = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(classSchedule(room.id))
  });
  assert.equal(created.status, 201);
  const createdSchedule = await created.json();

  const conflict = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(classSchedule(room.id, {
      startTime: '09:00',
      endTime: '11:00',
      course: 'BIO 102'
    }))
  });
  const conflictBody = await conflict.json();
  assert.equal(conflict.status, 409);
  assert.equal(conflictBody.conflict.overlapPeriod.startTime, '09:00');
  assert.equal(conflictBody.conflict.overlapPeriod.endTime, '10:00');

  const updated = await fetch(`${url}/api/schedules/${createdSchedule.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(classSchedule(room.id, {
      course: 'BIO 103',
      startTime: '10:00',
      endTime: '11:00'
    }))
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).course, 'BIO 103');

  const removed = await fetch(`${url}/api/schedules/${createdSchedule.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  });
  assert.equal(removed.status, 200);
  const remaining = await fetch(`${url}/api/schedules`);
  assert.deepEqual(await remaining.json(), []);

  const activityResponse = await fetch(`${url}/api/activity-logs?limit=20`, {
    headers: { Cookie: cookie }
  });
  assert.equal(activityResponse.status, 200);
  const activity = await activityResponse.json();
  const updateActivity = activity.items.find((item) => item.action === 'updated');
  assert.equal(activity.hasMore, false);
  assert.equal(activity.items.length, 4);
  assert.ok(activity.items.some((item) => item.action === 'signed_in'));
  assert.equal(updateActivity.previous.course, 'BIO 101');
  assert.equal(updateActivity.updated.course, 'BIO 103');
  assert.equal(updateActivity.classroomId, room.id);
  assert.ok(activity.items.some((item) =>
    item.action === 'deleted' && item.previous.id === createdSchedule.id
  ));
});

test('users can create accounts and reservations but cannot manage class schedules', async (t) => {
  const { database, url } = await startServer(t);
  const classroomId = (await database.listClassrooms({ buildingId: 'cas', floorId: '3' }))[0].id;

  const shortPassword = await fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'student', password: 'short' })
  });
  assert.equal(shortPassword.status, 400);

  const registration = await fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'student-1',
      password: 'student-password-long',
      role: 'admin'
    })
  });
  assert.equal(registration.status, 200);
  assert.equal((await registration.json()).user.role, 'user');
  const userCookie = registration.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${url}/api/reports`, {
    headers: { Cookie: userCookie }
  })).status, 403);
  assert.equal((await fetch(`${url}/api/activity-logs`, {
    headers: { Cookie: userCookie }
  })).status, 403);

  const userLogin = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'student-1',
      password: 'student-password-long'
    })
  });
  assert.equal(userLogin.status, 200);
  assert.equal((await userLogin.json()).user.role, 'user');

  const duplicate = await fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'student-1', password: 'student-password-long' })
  });
  assert.equal(duplicate.status, 409);

  const roleMismatch = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'student-1',
      password: 'student-password-long',
      role: 'admin'
    })
  });
  assert.equal(roleMismatch.status, 401);

  const reservationResponse = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify(reservation(classroomId))
  });
  assert.equal(reservationResponse.status, 201);
  const reservationRecord = await reservationResponse.json();
  assert.equal(reservationRecord.ownedByCurrentUser, true);
  assert.equal('createdByUsername' in reservationRecord, false);

  const classScheduleResponse = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify(classSchedule(classroomId))
  });
  assert.equal(classScheduleResponse.status, 403);

  // Another user cannot cancel it; the owner can.
  const otherCookie = await registerCookie(url, 'student-2');
  assert.equal((await fetch(`${url}/api/schedules/${reservationRecord.id}`, {
    method: 'DELETE',
    headers: { Cookie: otherCookie }
  })).status, 403);

  const mine = await fetch(`${url}/api/my/reservations`, { headers: { Cookie: userCookie } });
  assert.deepEqual((await mine.json()).map((item) => item.id), [reservationRecord.id]);

  const deleteReservation = await fetch(`${url}/api/schedules/${reservationRecord.id}`, {
    method: 'DELETE',
    headers: { Cookie: userCookie }
  });
  assert.equal(deleteReservation.status, 200);
});

test('concurrent bookings of the same slot cannot both succeed', async (t) => {
  const { database, url } = await startServer(t);
  const cookie = await loginCookie(url, 'admin', 'test-password-long-enough');
  const classroomId = (await database.listClassrooms({ buildingId: 'cit', floorId: '1' }))[3].id;
  const book = (course) => fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(classSchedule(classroomId, { course, date: '2027-04-05' }))
  });
  for (let round = 0; round < 3; round += 1) {
    const statuses = (await Promise.all([book(`RACE A${round}`), book(`RACE B${round}`)]))
      .map((response) => response.status)
      .sort();
    assert.deepEqual(statuses, round === 0 ? [201, 409] : [409, 409]);
  }
  assert.equal((await database.listSchedules({ classroomId })).length, 1);
});

test('invalid schedule input is rejected as a client error', async (t) => {
  const { database, url } = await startServer(t);
  const cookie = await loginCookie(url, 'admin', 'test-password-long-enough');
  const classroomId = (await database.listClassrooms({ buildingId: 'cas', floorId: '3' }))[0].id;
  const post = (body, raw) => fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: raw !== undefined ? raw : JSON.stringify(body)
  });
  assert.equal((await post(classSchedule('no-such-room'))).status, 400);
  assert.equal((await post(classSchedule(classroomId, { course: 'X'.repeat(121) }))).status, 400);
  assert.equal((await post(classSchedule(classroomId, { section: 'S'.repeat(65) }))).status, 400);
  assert.equal((await post(undefined, 'null')).status, 400);
  assert.equal((await post(undefined, '[]')).status, 400);
});

test('user reservations follow the booking rules', async (t) => {
  const { database, url } = await startServer(t);
  const cookie = await registerCookie(url, 'booker');
  const rooms = await database.listClassrooms({ buildingId: 'st' });
  const post = (body) => fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });

  assert.equal((await post(reservation(rooms[0].id, { date: '2020-01-06' }))).status, 400);
  assert.equal((await post(reservation(rooms[0].id, { date: futureDate(400) }))).status, 400);
  assert.equal((await post(reservation(rooms[0].id, { startTime: '08:00', endTime: '17:00' }))).status, 400);
  assert.equal((await post({
    ...reservation(rooms[0].id),
    recurrence: 'weekly',
    daysOfWeek: [1],
    startDate: futureDate(),
    date: undefined
  })).status, 400);

  // Course/instructor text sent by a user is not stored.
  const first = await post(reservation(rooms[0].id, { course: '<img src=x onerror=alert(1)>', instructor: 'spoofed' }));
  assert.equal(first.status, 201);
  const firstRecord = await first.json();
  assert.equal(firstRecord.course, '');
  assert.equal(firstRecord.instructor, '');

  for (let index = 1; index < 5; index += 1) {
    assert.equal((await post(reservation(rooms[index].id))).status, 201);
  }
  // Sixth upcoming reservation exceeds the per-user limit.
  assert.equal((await post(reservation(rooms[5].id))).status, 409);
});

test('schedule listings hide reservation owners from non-admins', async (t) => {
  const { database, url } = await startServer(t);
  const userCookie = await registerCookie(url, 'owner-1');
  const classroomId = (await database.listClassrooms({ buildingId: 'cas', floorId: '3' }))[0].id;
  assert.equal((await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify(reservation(classroomId))
  })).status, 201);

  const [publicItem] = await (await fetch(`${url}/api/schedules?kind=reservation`)).json();
  assert.equal('createdByUsername' in publicItem, false);
  assert.equal('createdByUserId' in publicItem, false);
  assert.equal(publicItem.ownedByCurrentUser, false);

  const adminCookie = await loginCookie(url, 'admin', 'test-password-long-enough');
  const [adminItem] = await (await fetch(`${url}/api/schedules?kind=reservation`, {
    headers: { Cookie: adminCookie }
  })).json();
  assert.equal(adminItem.createdByUsername, 'owner-1');
});

test('admin pages require an administrator session', async (t) => {
  const { url } = await startServer(t);
  const anonymous = await fetch(`${url}/admin/reports.html?tab=x`, { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/user/login.html?returnTo=%2Fadmin%2Freports.html%3Ftab%3Dx');

  // Traversal through the user folder cannot bypass the check.
  const sneaky = await fetch(`${url}/user/..%2Fadmin%2Freports.html`, { redirect: 'manual' });
  assert.notEqual(sneaky.status, 200);

  const userCookie = await registerCookie(url, 'not-admin');
  const asUser = await fetch(`${url}/admin/activity-logs.html`, { redirect: 'manual', headers: { Cookie: userCookie } });
  assert.equal(asUser.status, 302);
  assert.equal(asUser.headers.get('location'), '/user/dashboard.html?denied=admin');

  const adminCookie = await loginCookie(url, 'admin', 'test-password-long-enough');
  assert.equal((await fetch(`${url}/admin/activity-logs.html`, { headers: { Cookie: adminCookie } })).status, 200);
  // Scripts and styles stay public.
  assert.equal((await fetch(`${url}/admin/js/reports.js`)).status, 200);
});

test('session cookie is Secure only on HTTPS requests', async (t) => {
  const { url } = await startServer(t);
  const login = (headers = {}) => fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ username: 'admin', password: 'test-password-long-enough' })
  });
  const previous = { secure: process.env.ROOMQ_COOKIE_SECURE, proxy: process.env.ROOMQ_TRUST_PROXY };
  t.after(() => {
    for (const [key, value] of [['ROOMQ_COOKIE_SECURE', previous.secure], ['ROOMQ_TRUST_PROXY', previous.proxy]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  delete process.env.ROOMQ_COOKIE_SECURE;
  delete process.env.ROOMQ_TRUST_PROXY;

  assert.doesNotMatch((await login()).headers.get('set-cookie'), /Secure/);
  // An untrusted X-Forwarded-Proto header is ignored.
  assert.doesNotMatch((await login({ 'X-Forwarded-Proto': 'https' })).headers.get('set-cookie'), /Secure/);
  process.env.ROOMQ_TRUST_PROXY = 'true';
  assert.match((await login({ 'X-Forwarded-Proto': 'https' })).headers.get('set-cookie'), /Secure/);
  process.env.ROOMQ_COOKIE_SECURE = 'true';
  assert.match((await login()).headers.get('set-cookie'), /Secure/);
});

test('failed sign-ins lock only the targeted account, and failed sign-ups are not counted', async (t) => {
  const { url } = await startServer(t);
  await registerCookie(url, 'victim');
  const attempt = (username, password) => fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await attempt('admin', 'wrong-password-123')).status, 401);
  }
  assert.equal((await attempt('admin', 'test-password-long-enough')).status, 429);
  // Other accounts from the same address still sign in.
  assert.equal((await attempt('victim', 'victim-password-long')).status, 200);

  for (let index = 0; index < 12; index += 1) {
    const response = await fetch(`${url}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'short' })
    });
    assert.equal(response.status, 400);
  }
  await registerCookie(url, 'still-allowed');
});

test('admin self-signup requires the setup key and creates an admin session', async (t) => {
  const { database, url } = await startServer(t, {
    adminSignupKey: 'private-admin-setup-key-2026'
  });
  const invalidSetupKey = await fetch(`${url}/api/register-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin-two',
      password: 'another-admin-password',
      setupKey: 'incorrect-private-key'
    })
  });
  assert.equal(invalidSetupKey.status, 401);

  const registration = await fetch(`${url}/api/register-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin-two',
      password: 'another-admin-password',
      setupKey: 'private-admin-setup-key-2026'
    })
  });
  assert.equal(registration.status, 200);
  assert.equal((await registration.json()).user.role, 'admin');
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  const room = (await database.listClassrooms({ buildingId: 'cas', floorId: '3' }))[0];
  const schedule = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(classSchedule(room.id))
  });
  assert.equal(schedule.status, 201);
});

// ---------------------------------------------------------------------------
// Role-based access control: administrator / staff / user
// ---------------------------------------------------------------------------

// Small JSON client bound to one session cookie.
function client(url, cookie) {
  return async (method, path, body) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON (a static page or a redirect)
    }
    return { status: response.status, json, location: response.headers.get('location') };
  };
}

// A server with a signed-in administrator and one staff account that the
// administrator created through the API.
async function rbacFixture(t) {
  const { database, url } = await startServer(t);
  const adminCookie = await loginCookie(url, 'admin', 'test-password-long-enough');
  const admin = client(url, adminCookie);
  const created = await admin('POST', '/api/users', {
    username: 'staff-one',
    password: 'staff-one-password',
    fullName: 'Staff One',
    email: 'staff.one@example.com',
    role: 'staff'
  });
  assert.equal(created.status, 201);
  const staffCookie = await loginCookie(url, 'staff-one', 'staff-one-password');
  return {
    database,
    url,
    admin,
    staff: client(url, staffCookie),
    staffId: created.json.id,
    guest: client(url)
  };
}

test('permission table gives staff a limited set and administrators everything', () => {
  const { PERMISSIONS, can, ROLE_PERMISSIONS } = require('../src/permissions');
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(can({ role: 'admin' }, permission), true, `admin ${permission}`);
  }
  assert.equal(can({ role: 'staff' }, PERMISSIONS.SCHEDULES_CREATE), true);
  assert.equal(can({ role: 'staff' }, PERMISSIONS.SCHEDULES_UPDATE), true);
  assert.equal(can({ role: 'staff' }, PERMISSIONS.CONFLICTS_VIEW), true);
  for (const denied of [
    PERMISSIONS.SCHEDULES_DELETE, PERMISSIONS.REPORTS_VIEW, PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.USERS_MANAGE, PERMISSIONS.PORTAL_ADMIN
  ]) {
    assert.equal(can({ role: 'staff' }, denied), false, `staff ${denied}`);
  }
  assert.deepEqual(ROLE_PERMISSIONS.user, []);
  assert.equal(can(null, PERMISSIONS.PORTAL_STAFF), false);
  assert.equal(can({ role: 'nonsense' }, PERMISSIONS.PORTAL_STAFF), false);
});

test('administrator creates a staff account and staff sign in with their own permissions', async (t) => {
  const { staff, url, database, staffId } = await rbacFixture(t);

  const me = await staff('GET', '/api/me');
  assert.equal(me.json.user.role, 'staff');
  assert.equal(me.json.user.fullName, 'Staff One');
  assert.deepEqual([...me.json.user.permissions].sort(), [
    'conflicts.view', 'portal.staff', 'schedules.create', 'schedules.update'
  ]);

  // The role is persisted in MySQL, and the password is stored hashed.
  const stored = await database.getUserById(staffId);
  assert.equal(stored.role, 'staff');
  assert.equal(stored.isActive, true);
  const raw = await database.getUser('staff-one');
  assert.match(raw.password_hash, /^[0-9a-f]{128}$/);
  assert.notEqual(raw.password_hash, 'staff-one-password');

  // Signing in as the staff role explicitly works; as the wrong role does not.
  const login = (role) => fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'staff-one', password: 'staff-one-password', role })
  });
  assert.equal((await login('staff')).status, 200);
  assert.equal((await login('admin')).status, 401);
});

test('staff cannot reach administrator API endpoints', async (t) => {
  const { staff, guest, staffId } = await rbacFixture(t);
  const probes = [
    ['GET', '/api/users'],
    ['POST', '/api/users', { username: 'evil-admin', password: 'evil-admin-password', role: 'admin' }],
    ['GET', `/api/users/${staffId}`],
    ['PUT', `/api/users/${staffId}`, { role: 'admin' }],
    ['DELETE', `/api/users/${staffId}`],
    ['GET', '/api/reports'],
    ['GET', '/api/activity-logs']
  ];
  for (const [method, path, body] of probes) {
    assert.equal((await staff(method, path, body)).status, 403, `staff ${method} ${path}`);
    assert.equal((await guest(method, path, body)).status, 401, `guest ${method} ${path}`);
  }
  assert.equal((await staff('GET', '/api/me')).json.user.role, 'staff');
});

test('staff can add and update schedules and see conflicts, but cannot delete schedules', async (t) => {
  const { staff, admin, database } = await rbacFixture(t);
  const classroomId = (await database.listClassrooms({ buildingId: 'cas', floorId: '3' }))[0].id;

  const created = await staff('POST', '/api/schedules', classSchedule(classroomId));
  assert.equal(created.status, 201);
  const updated = await staff(
    'PUT', `/api/schedules/${created.json.id}`, classSchedule(classroomId, { course: 'BIO 200' })
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.json.course, 'BIO 200');
  assert.equal((await staff('GET', '/api/conflicts')).status, 200);

  assert.equal((await staff('DELETE', `/api/schedules/${created.json.id}`)).status, 403);
  assert.equal((await database.getSchedule(created.json.id)).course, 'BIO 200');
  // Staff do not see who made a schedule; administrators do.
  const listed = await staff('GET', '/api/schedules');
  assert.equal('createdByUsername' in listed.json[0], false);
  assert.equal((await admin('GET', '/api/schedules')).json[0].createdByUsername, 'staff-one');
  assert.equal((await admin('DELETE', `/api/schedules/${created.json.id}`)).status, 200);
});

test('staff cannot change their own role or status, however the request is made', async (t) => {
  const { staff, url, staffId, database } = await rbacFixture(t);

  for (const body of [
    { role: 'admin' }, { isActive: false }, { fullName: 'X', role: 'admin' }, { permissions: ['users.manage'] }
  ]) {
    assert.equal((await staff('PUT', '/api/account', body)).status, 403, JSON.stringify(body));
  }
  assert.equal((await staff('PUT', `/api/users/${staffId}`, { role: 'admin' })).status, 403);
  // Self-registration cannot create a privileged account either.
  const registered = await fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sneaky', password: 'sneaky-password-long', role: 'staff' })
  });
  assert.equal((await registered.json()).user.role, 'user');

  assert.equal((await database.getUserById(staffId)).role, 'staff');
  assert.equal((await staff('GET', '/api/me')).json.user.role, 'staff');
});

test('portal pages are routed by role', async (t) => {
  const { staff, admin, guest, url } = await rbacFixture(t);
  const user = client(url, await registerCookie(url, 'plain-user'));

  // Staff: their pages (including the shared schedule/conflict/classroom pages) open.
  for (const page of ['dashboard.html', 'account.html', 'schedules.html', 'conflicts.html', 'classrooms.html']) {
    assert.equal((await staff('GET', `/staff/${page}`)).status, 200, `staff ${page}`);
  }
  assert.equal((await staff('GET', '/staff/js/schedules.js')).status, 200);
  assert.equal((await staff('GET', '/staff/js/staff-dashboard.js')).status, 200);
  // ...but not the administrator portal or admin-only modules.
  for (const page of ['dashboard.html', 'users.html', 'reports.html', 'activity-logs.html', 'schedules.html']) {
    const response = await staff('GET', `/admin/${page}`);
    assert.equal(response.status, 302, `staff /admin/${page}`);
    assert.equal(response.location, '/staff/dashboard.html?denied=admin');
  }
  for (const page of ['reports.html', 'activity-logs.html', 'users.html', 'assignments.html', 'insights.html']) {
    const response = await staff('GET', `/staff/${page}`);
    assert.equal(response.location, '/staff/dashboard.html?denied=admin', `staff /staff/${page}`);
  }
  assert.equal((await staff('GET', '/')).location, '/staff/dashboard.html');
  assert.equal((await staff('GET', '/staff')).location, '/staff/dashboard.html');

  // Administrators use the admin portal (and the shared account page).
  assert.equal((await admin('GET', '/admin/users.html')).status, 200);
  assert.equal((await admin('GET', '/staff/schedules.html')).location, '/admin/schedules.html');
  assert.equal((await admin('GET', '/staff/dashboard.html')).location, '/admin/dashboard.html');
  assert.equal((await admin('GET', '/staff/account.html')).status, 200);
  assert.equal((await admin('GET', '/')).location, '/admin/dashboard.html');

  // Plain users and guests get neither portal.
  assert.equal((await user('GET', '/staff/dashboard.html')).location, '/user/dashboard.html?denied=staff');
  assert.equal((await user('GET', '/admin/users.html')).location, '/user/dashboard.html?denied=admin');
  assert.equal(
    (await guest('GET', '/staff/dashboard.html')).location,
    '/user/login.html?returnTo=%2Fstaff%2Fdashboard.html'
  );
  assert.match((await guest('GET', '/admin/users.html')).location, /^\/user\/login\.html\?returnTo=/);
  assert.equal((await guest('GET', '/staff/js/nope.js')).status, 404);
});

test('administrators manage accounts: create, search, edit, deactivate, delete', async (t) => {
  const { admin, url, staffId, database } = await rbacFixture(t);

  // Validation and duplicates.
  assert.equal((await admin('POST', '/api/users', { username: 'x', password: 'long-enough-password' })).status, 400);
  assert.equal((await admin('POST', '/api/users', { username: 'okname', password: 'short' })).status, 400);
  assert.equal((await admin('POST', '/api/users', {
    username: 'okname', password: 'long-enough-password', role: 'root'
  })).status, 400);
  assert.equal((await admin('POST', '/api/users', {
    username: 'okname', password: 'long-enough-password', email: 'not-an-email'
  })).status, 400);
  assert.equal((await admin('POST', '/api/users', { username: 'staff-one', password: 'long-enough-password' })).status, 409);
  assert.equal((await admin('POST', '/api/users', {
    username: 'other', password: 'long-enough-password', email: 'STAFF.ONE@example.com'
  })).status, 409);
  assert.equal((await admin('GET', '/api/users/99999')).status, 404);
  assert.equal((await admin('PUT', '/api/users/99999', { fullName: 'x' })).status, 404);

  // Create more accounts, then search and filter.
  await admin('POST', '/api/users', {
    username: 'staff-two', password: 'staff-two-password', fullName: 'Maria Cruz', role: 'staff', isActive: false
  });
  await admin('POST', '/api/users', { username: 'second-admin', password: 'second-admin-password', role: 'admin' });
  const names = (response) => response.json.map((account) => account.username);
  assert.deepEqual(names(await admin('GET', '/api/users?role=staff')).sort(), ['staff-one', 'staff-two']);
  assert.deepEqual(names(await admin('GET', '/api/users?role=staff&status=inactive')), ['staff-two']);
  assert.deepEqual(names(await admin('GET', '/api/users?q=cruz')), ['staff-two']);
  assert.deepEqual(names(await admin('GET', '/api/users?q=example.com')), ['staff-one']);
  assert.equal((await admin('GET', '/api/users?q=%25')).json.length, 0, 'LIKE wildcards are escaped');
  assert.equal((await admin('GET', '/api/users?role=bogus')).status, 400);
  const listing = (await admin('GET', '/api/users')).json;
  assert.equal(listing.some((account) => 'password_hash' in account || 'passwordHash' in account), false);

  // Edit: role changes persist and apply to the live session immediately.
  const staff = client(url, await loginCookie(url, 'staff-one', 'staff-one-password'));
  assert.equal((await staff('GET', '/api/users')).status, 403);
  const promoted = await admin('PUT', `/api/users/${staffId}`, { role: 'admin' });
  assert.equal(promoted.json.role, 'admin');
  assert.equal((await database.getUserById(staffId)).role, 'admin');
  assert.equal((await staff('GET', '/api/users')).status, 200, 'permission follows the stored role at once');
  const renamed = await admin('PUT', `/api/users/${staffId}`, { role: 'staff', fullName: 'Staff One Renamed' });
  assert.equal(renamed.json.fullName, 'Staff One Renamed');
  assert.equal((await staff('GET', '/api/users')).status, 403);

  // Deactivate: open sessions end and sign-in is refused (after the right password).
  assert.equal((await admin('PUT', `/api/users/${staffId}`, { isActive: false })).json.isActive, false);
  assert.equal((await staff('GET', '/api/me')).json.authenticated, false);
  const attempt = (password) => fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'staff-one', password })
  });
  assert.equal((await attempt('staff-one-password')).status, 403);
  assert.equal((await attempt('wrong-password-here')).status, 401, 'wrong password does not reveal the status');
  assert.equal((await admin('PUT', `/api/users/${staffId}`, { isActive: true })).json.isActive, true);
  assert.equal((await attempt('staff-one-password')).status, 200);

  // Password reset by an administrator replaces the old password.
  assert.equal((await admin('PUT', `/api/users/${staffId}`, { password: 'brand-new-password-1' })).status, 200);
  assert.equal((await attempt('staff-one-password')).status, 401);
  assert.equal((await attempt('brand-new-password-1')).status, 200);
  assert.equal((await admin('PUT', `/api/users/${staffId}`, {})).status, 400);

  // Delete: gone from MySQL; their past activity remains in the audit trail.
  assert.equal((await admin('DELETE', `/api/users/${staffId}`)).status, 200);
  assert.equal(await database.getUserById(staffId), null);
  assert.equal((await admin('DELETE', `/api/users/${staffId}`)).status, 404);
  const logs = (await admin('GET', '/api/activity-logs?limit=200')).json.items;
  assert.ok(logs.some((item) =>
    item.entityType === 'user' && item.action === 'created' && item.updated.username === 'staff-one'));
  assert.ok(logs.some((item) =>
    item.entityType === 'user' && item.action === 'updated' && item.previous && item.updated.role === 'admin'));
  assert.ok(logs.some((item) =>
    item.entityType === 'user' && item.action === 'deleted' && item.previous.username === 'staff-one'));
  assert.equal(JSON.stringify(logs).includes('password_hash'), false);
  assert.equal(JSON.stringify(logs).includes('brand-new-password-1'), false);
});

test('the system always keeps one active administrator', async (t) => {
  const { admin, url, database } = await rbacFixture(t);
  const adminAccount = (await admin('GET', '/api/users?role=admin')).json[0];

  // The only administrator cannot be demoted, deactivated or deleted.
  for (const body of [{ role: 'staff' }, { isActive: false }, { role: 'user' }]) {
    assert.equal((await admin('PUT', `/api/users/${adminAccount.id}`, body)).status, 409, JSON.stringify(body));
  }
  assert.equal((await admin('DELETE', `/api/users/${adminAccount.id}`)).status, 409);
  assert.equal((await database.getUserById(adminAccount.id)).role, 'admin');
  assert.equal((await admin('GET', '/api/me')).json.authenticated, true);

  // With a second administrator, the first may step down; the last one never can.
  const second = await admin('POST', '/api/users', {
    username: 'admin-two', password: 'admin-two-password', role: 'admin'
  });
  assert.equal(second.status, 201);
  const secondAdmin = client(url, await loginCookie(url, 'admin-two', 'admin-two-password'));
  assert.equal((await secondAdmin('PUT', `/api/users/${adminAccount.id}`, { role: 'staff' })).status, 200);
  assert.equal((await secondAdmin('PUT', `/api/users/${second.json.id}`, { role: 'staff' })).status, 409);
  assert.equal((await secondAdmin('DELETE', `/api/users/${second.json.id}`)).status, 409, 'cannot delete yourself');
  assert.equal((await database.listUsers({ role: 'admin', status: 'active' })).length, 1);
});

test('two administrators cannot remove each other at the same time', async (t) => {
  const { admin, url, database } = await rbacFixture(t);
  const first = (await admin('GET', '/api/users?role=admin')).json[0];
  const second = await admin('POST', '/api/users', {
    username: 'admin-two', password: 'admin-two-password', role: 'admin'
  });
  const secondAdmin = client(url, await loginCookie(url, 'admin-two', 'admin-two-password'));

  const results = await Promise.all([
    admin('PUT', `/api/users/${second.json.id}`, { isActive: false }),
    secondAdmin('PUT', `/api/users/${first.id}`, { isActive: false })
  ]);
  assert.ok(results.filter((result) => result.status === 200).length <= 1, 'at most one removal succeeds');
  assert.ok((await database.listUsers({ role: 'admin', status: 'active' })).length >= 1);
});

test('accounts manage their own details and password', async (t) => {
  const { staff, url, database, staffId } = await rbacFixture(t);

  const account = await staff('GET', '/api/account');
  assert.equal(account.status, 200);
  assert.equal(account.json.username, 'staff-one');
  assert.equal(account.json.role, 'staff');
  assert.equal('password_hash' in account.json, false);
  assert.equal((await client(url)('GET', '/api/account')).status, 401);

  const saved = await staff('PUT', '/api/account', { fullName: 'Renamed Staff', email: 'Renamed@Example.com' });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.email, 'renamed@example.com');
  assert.equal((await database.getUserById(staffId)).fullName, 'Renamed Staff');
  assert.equal((await staff('PUT', '/api/account', { email: 'bad' })).status, 400);
  assert.equal((await staff('PUT', '/api/account', {})).status, 400);

  // Password change needs the current password and a different, long-enough one.
  const change = (currentPassword, newPassword) =>
    staff('POST', '/api/account/password', { currentPassword, newPassword });
  assert.equal((await change('wrong-current-password', 'a-brand-new-password')).status, 403);
  assert.equal((await change('staff-one-password', 'short')).status, 400);
  assert.equal((await change('staff-one-password', 'staff-one-password')).status, 400);

  const otherSession = client(url, await loginCookie(url, 'staff-one', 'staff-one-password'));
  assert.equal((await change('staff-one-password', 'a-brand-new-password')).status, 200);
  assert.equal((await staff('GET', '/api/me')).json.authenticated, true, 'this session stays signed in');
  assert.equal((await otherSession('GET', '/api/me')).json.authenticated, false, 'other sessions end');
  const login = (password) => fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'staff-one', password })
  });
  assert.equal((await login('staff-one-password')).status, 401);
  assert.equal((await login('a-brand-new-password')).status, 200);
});

test('existing accounts keep their roles when an older database is upgraded', async (t) => {
  const base = readEnvConfig();
  const name = `roomq_test_${crypto.randomBytes(6).toString('hex')}`;
  const admin = await mysql.createConnection({
    host: base.host, port: base.port, user: base.user, password: base.password
  });
  t.after(async () => {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.end();
  });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  // The users table exactly as it was before staff accounts existed.
  await admin.query(`CREATE TABLE \`${name}\`.users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(32) NOT NULL,
    password_salt VARCHAR(64) NOT NULL,
    password_hash VARCHAR(128) NOT NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await admin.query(
    `INSERT INTO \`${name}\`.users (username, password_salt, password_hash, role) VALUES
     ('old-admin', 'aa', 'bb', 'admin'), ('old-student', 'cc', 'dd', 'user')`
  );

  const database = await createDatabase({ database: name, connectAttempts: 5, connectDelayMs: 200 });
  t.after(() => database.close());

  const oldAdmin = await database.getUser('old-admin');
  const oldStudent = await database.getUser('old-student');
  assert.equal(oldAdmin.role, 'admin');
  assert.equal(oldStudent.role, 'user');
  assert.equal(oldAdmin.is_active, 1, 'existing accounts stay active');
  assert.equal(oldAdmin.password_hash, 'bb', 'credentials are untouched');
  assert.equal((await database.listUsers()).length, 2, 'no accounts were created or lost');

  const staff = await database.createUser('new-staff', 'new-staff-password', 'staff', { fullName: 'New Staff' });
  assert.equal(staff.role, 'staff');
  const [rows] = await admin.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [name]
  );
  assert.match(rows[0].COLUMN_TYPE, /'admin','staff','user'/);
  await assert.rejects(
    () => admin.query(
      `INSERT INTO \`${name}\`.users (username, password_salt, password_hash, role)
       VALUES ('bad', 'a', 'b', 'superuser')`
    ),
    /Data truncated|Incorrect enum/i,
    'the database itself rejects unknown roles'
  );
});
