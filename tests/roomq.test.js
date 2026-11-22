const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createDatabase } = require('../src/roomq-db');
const { createServer } = require('../src/server');
const {
  appliesOnDate,
  findScheduleOverlap,
  validateScheduleInput
} = require('../src/schedule-rules');

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

test('database seeds only the existing mapped rooms and prevents double-booking', (t) => {
  const database = createDatabase(':memory:', {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  t.after(() => database.close());
  const rooms = database.listClassrooms({ buildingId: 'cas', floorId: '3' });

  assert.equal(database.listBuildings().length, 8);
  assert.equal(rooms.length, 11);
  assert.equal(database.listClassrooms({ buildingId: 'law' }).length, 0);

  const classroomId = rooms[0].id;
  const first = database.saveSchedule(classSchedule(classroomId));
  assert.equal(first.classroomId, classroomId);

  assert.throws(
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

  const adjacent = database.saveSchedule(classSchedule(classroomId, {
    startTime: '10:00',
    endTime: '11:00'
  }));
  assert.ok(adjacent.id > first.id);

  const availability = database.getAvailability({
    date: '2026-11-17',
    startTime: '09:00',
    endTime: '09:30',
    buildingId: 'cas',
    floorId: '3'
  });
  assert.equal(availability.find((room) => room.id === classroomId).status, 'occupied');
  assert.equal(availability.filter((room) => room.status === 'available').length, 10);

  database.saveSchedule({
    kind: 'reservation',
    classroomId,
    recurrence: 'once',
    date: '2026-11-17',
    startTime: '11:00',
    endTime: '12:00'
  });
  const reservedAvailability = database.getAvailability({
    date: '2026-11-17',
    startTime: '11:15',
    endTime: '11:30',
    buildingId: 'cas',
    floorId: '3'
  });
  assert.equal(reservedAvailability.find((room) => room.id === classroomId).status, 'reserved');
});

test('availability rejects impossible calendar dates as client errors', (t) => {
  const database = createDatabase(':memory:', {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  t.after(() => database.close());

  assert.throws(
    () => database.getAvailability({
      date: '2026-02-30',
      startTime: '09:00',
      endTime: '10:00'
    }),
    (error) => error.status === 400
  );
});

test('root redirects to the dashboard and the sign-in page has no account-type switch', async (t) => {
  const database = createDatabase(':memory:', {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  const server = createServer({ database });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  });

  const url = `http://127.0.0.1:${server.address().port}`;
  const root = await fetch(url, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/admin/index.html');

  const legacyIndex = await fetch(`${url}/index.html`, { redirect: 'manual' });
  assert.equal(legacyIndex.status, 302);
  assert.equal(legacyIndex.headers.get('location'), '/admin/index.html');

  const legacyLogin = await fetch(`${url}/login.html?returnTo=%2Fclient%2Fclassrooms.html`, { redirect: 'manual' });
  assert.equal(legacyLogin.status, 302);
  assert.equal(legacyLogin.headers.get('location'), '/client/login.html?returnTo=%2Fclient%2Fclassrooms.html');

  const loginPage = await fetch(`${url}/client/login.html`);
  assert.equal(loginPage.status, 200);
  assert.doesNotMatch(await loginPage.text(), /data-auth-role|auth-role-switch|adminSetupKey/);

  for (const asset of ['admin/css/style.css', 'client/css/style.css', 'css/style.css', 'shared/js/roomq-api.js', 'admin/js/dashboard.js']) {
    const response = await fetch(`${url}/${asset}`);
    assert.equal(response.status, 200);
  }
});

test('API protects schedule changes and returns conflicting schedule details', async (t) => {
  const database = createDatabase(':memory:', {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  const server = createServer({ database });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const page of ['admin/reports.html', 'admin/activity-logs.html']) {
    const response = await fetch(`${url}/${page}`);
    assert.equal(response.status, 200);
  }
  for (const script of ['admin/js/reports.js', 'admin/js/activity-logs.js']) {
    const response = await fetch(`${url}/${script}`);
    assert.equal(response.status, 200);
  }
  const room = database.listClassrooms({ buildingId: 'cas', floorId: '3' })[0];
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
  assert.equal((await initialReports.json()).classrooms.length, database.listClassrooms().length);

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
  const database = createDatabase(':memory:', {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  const server = createServer({ database });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const classroomId = database.listClassrooms({ buildingId: 'cas', floorId: '3' })[0].id;

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

  const reservation = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify(classSchedule(classroomId, { kind: 'reservation' }))
  });
  assert.equal(reservation.status, 201);
  const reservationRecord = await reservation.json();

  const classScheduleResponse = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify(classSchedule(classroomId))
  });
  assert.equal(classScheduleResponse.status, 403);

  const deleteReservation = await fetch(`${url}/api/schedules/${reservationRecord.id}`, {
    method: 'DELETE',
    headers: { Cookie: userCookie }
  });
  assert.equal(deleteReservation.status, 403);
});

test('admin self-signup requires the setup key and creates an admin session', async (t) => {
  const database = createDatabase(':memory:', {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  const server = createServer({
    database,
    adminSignupKey: 'private-admin-setup-key-2026'
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
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
  const room = database.listClassrooms({ buildingId: 'cas', floorId: '3' })[0];
  const schedule = await fetch(`${url}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(classSchedule(room.id))
  });
  assert.equal(schedule.status, 201);
});

test('database migration preserves existing administrator sessions and permits user roles', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'roomq-auth-migration-'));
  const filePath = path.join(directory, 'roomq.sqlite');
  let database;
  t.after(() => {
    if (database) {
      database.close();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const legacyDatabase = new DatabaseSync(filePath);
  legacyDatabase.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin'))
    );
    CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
    INSERT INTO users (id, username, password_salt, password_hash, role)
      VALUES (1, 'admin', 'salt', 'hash', 'admin');
    INSERT INTO auth_sessions (token_hash, user_id, expires_at)
      VALUES ('existing-session', 1, 9999999999999);
  `);
  legacyDatabase.close();

  database = createDatabase(filePath, {
    username: 'admin',
    password: 'test-password-long-enough'
  });
  assert.equal(database.findSession('existing-session').username, 'admin');
  assert.equal(database.createUser('student', 'student-password-long').role, 'user');
});
