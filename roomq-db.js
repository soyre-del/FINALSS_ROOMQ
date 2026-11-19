const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { buildings } = require('../public/roomq-data');
const {
  appliesOnDate,
  findScheduleOverlap,
  isValidDate,
  validateScheduleInput
} = require('./schedule-rules');

function createDatabase(filePath = path.join(__dirname, '..', 'roomq.sqlite'), options = {}) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS buildings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS floors (
      building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      crop_x REAL NOT NULL,
      crop_y REAL NOT NULL,
      crop_width REAL NOT NULL,
      crop_height REAL NOT NULL,
      PRIMARY KEY (building_id, id)
    );
    CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      floor_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      room_number INTEGER,
      name TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      capacity INTEGER,
      facilities_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE (building_id, floor_id, region_id),
      FOREIGN KEY (building_id, floor_id) REFERENCES floors(building_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user'))
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('class', 'reservation')),
      course TEXT NOT NULL DEFAULT '',
      section TEXT NOT NULL DEFAULT '',
      instructor TEXT NOT NULL DEFAULT '',
      classroom_id TEXT REFERENCES classrooms(id) ON DELETE RESTRICT,
      recurrence TEXT NOT NULL CHECK (recurrence IN ('once', 'weekly')),
      date TEXT,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      start_date TEXT,
      end_date TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (start_time < end_time),
      CHECK (
        (recurrence = 'once' AND date IS NOT NULL AND start_date IS NULL AND end_date IS NULL)
        OR
        (recurrence = 'weekly' AND date IS NULL AND start_date IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS schedules_classroom_idx ON schedules(classroom_id);
    CREATE INDEX IF NOT EXISTS schedules_date_idx ON schedules(date, start_date, end_date);
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
  `);

  migrateUserRoles(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL CHECK (
        action IN ('created', 'updated', 'deleted', 'registered', 'signed_in', 'signed_out')
      ),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('schedule', 'reservation', 'user', 'session')),
      entity_id TEXT,
      classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
      previous_json TEXT,
      updated_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON activity_logs(created_at, id);
    CREATE INDEX IF NOT EXISTS activity_logs_actor_idx ON activity_logs(actor_username);
  `);
  seedBuildings(db);
  seedAdmin(db, options);

  function migrateUserRoles(database) {
    const schema = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).get();
    if (schema.sql.includes("'user'")) {
      return;
    }

    database.exec('PRAGMA foreign_keys = OFF');
    try {
      database.exec('BEGIN IMMEDIATE');
      database.exec(`
        ALTER TABLE auth_sessions RENAME TO auth_sessions_legacy;
        ALTER TABLE users RENAME TO users_legacy;
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'user'))
        );
        CREATE TABLE auth_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        INSERT INTO users (id, username, password_salt, password_hash, role)
          SELECT id, username, password_salt, password_hash, role FROM users_legacy;
        INSERT INTO auth_sessions (token_hash, user_id, expires_at)
          SELECT token_hash, user_id, expires_at FROM auth_sessions_legacy;
        DROP TABLE auth_sessions_legacy;
        DROP TABLE users_legacy;
        CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      database.exec('PRAGMA foreign_keys = ON');
    }
  }

  function seedBuildings(database) {
    const insertBuilding = database.prepare(
      'INSERT INTO buildings (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'
    );
    const insertFloor = database.prepare(`
      INSERT INTO floors (building_id, id, label, crop_x, crop_y, crop_width, crop_height)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(building_id, id) DO UPDATE SET
        label = excluded.label, crop_x = excluded.crop_x, crop_y = excluded.crop_y,
        crop_width = excluded.crop_width, crop_height = excluded.crop_height
    `);
    const insertClassroom = database.prepare(`
      INSERT INTO classrooms (
        id, building_id, floor_id, region_id, room_number, name, x, y, width, height
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        building_id = excluded.building_id, floor_id = excluded.floor_id,
        region_id = excluded.region_id, room_number = excluded.room_number,
        name = excluded.name, x = excluded.x, y = excluded.y,
        width = excluded.width, height = excluded.height
    `);

    for (const building of buildings) {
      insertBuilding.run(building.id, building.name);
      for (const floor of building.floors) {
        insertFloor.run(
          building.id,
          floor.id,
          floor.label,
          floor.crop.x,
          floor.crop.y,
          floor.crop.width,
          floor.crop.height
        );
        floor.regions.forEach((region, index) => {
          const roomNumber = region.roomNumber !== undefined
            ? region.roomNumber
            : Number(floor.id) * 100 + index + 1;
          insertClassroom.run(
            `${building.id}-${floor.id}-${region.id}`,
            building.id,
            floor.id,
            region.id,
            Number.isInteger(roomNumber) ? roomNumber : null,
            region.name || null,
            region.x,
            region.y,
            region.width,
            region.height
          );
        });
      }
    }
  }

  function seedAdmin(database, { username, password } = {}) {
    const existing = database.prepare('SELECT id FROM users LIMIT 1').get();
    if (existing) {
      return;
    }
    const adminUsername = username || process.env.ROOMQ_ADMIN_USERNAME || 'admin';
    const adminPassword = password || process.env.ROOMQ_ADMIN_PASSWORD;
    if (!adminPassword || adminPassword.length < 12) {
      throw new Error('Set ROOMQ_ADMIN_PASSWORD to a password of at least 12 characters before starting RoomQ.');
    }
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(adminPassword, salt, 64);
    database.prepare(`
      INSERT INTO users (username, password_salt, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run(adminUsername, salt.toString('hex'), hash.toString('hex'));
  }

  function getUser(username) {
    return db.prepare(`
      SELECT id, username, password_salt, password_hash, role
      FROM users WHERE username = ?
    `).get(username);
  }

  function createUser(username, password, role = 'user') {
    if (!['admin', 'user'].includes(role)) {
      throw new Error('User role is invalid.');
    }
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    const result = db.prepare(`
      INSERT INTO users (username, password_salt, password_hash, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO NOTHING
    `).run(username, salt.toString('hex'), hash.toString('hex'), role);
    return result.changes ? getUser(username) : null;
  }

  function createSession(userId, tokenHash, expiresAt) {
    db.prepare(`
      INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)
    `).run(tokenHash, userId, expiresAt);
  }

  function findSession(tokenHash) {
    const now = Date.now();
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
    return db.prepare(`
      SELECT u.id, u.username, u.role
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, now);
  }

  function deleteSession(tokenHash) {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
  }

  function listBuildings() {
    const rows = db.prepare(`
      SELECT b.id AS building_id, b.name AS building_name,
        f.id AS floor_id, f.label AS floor_label
      FROM buildings b LEFT JOIN floors f ON f.building_id = b.id
      ORDER BY b.name, CAST(f.id AS INTEGER)
    `).all();
    const buildingMap = new Map();
    for (const row of rows) {
      if (!buildingMap.has(row.building_id)) {
        buildingMap.set(row.building_id, {
          id: row.building_id,
          name: row.building_name,
          floors: []
        });
      }
      if (row.floor_id !== null) {
        buildingMap.get(row.building_id).floors.push({
          id: row.floor_id,
          label: row.floor_label
        });
      }
    }
    return [...buildingMap.values()];
  }

  function mapClassroom(row) {
    return {
      id: row.id,
      buildingId: row.building_id,
      buildingName: row.building_name,
      floorId: row.floor_id,
      floorLabel: row.floor_label,
      regionId: row.region_id,
      roomNumber: row.room_number,
      name: row.name,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      capacity: row.capacity,
      facilities: JSON.parse(row.facilities_json)
    };
  }

  function listClassrooms(filters = {}) {
    const conditions = [];
    const values = [];
    if (filters.buildingId) {
      conditions.push('c.building_id = ?');
      values.push(filters.buildingId);
    }
    if (filters.floorId) {
      conditions.push('c.floor_id = ?');
      values.push(filters.floorId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT c.*, b.name AS building_name, f.label AS floor_label
      FROM classrooms c
      JOIN buildings b ON b.id = c.building_id
      JOIN floors f ON f.building_id = c.building_id AND f.id = c.floor_id
      ${where}
      ORDER BY b.name, CAST(c.floor_id AS INTEGER), c.room_number, c.name
    `).all(...values);
    return rows.map(mapClassroom);
  }

  function mapSchedule(row) {
    return {
      id: row.id,
      kind: row.kind,
      course: row.course,
      section: row.section,
      instructor: row.instructor,
      classroomId: row.classroom_id,
      recurrence: row.recurrence,
      date: row.date,
      daysOfWeek: JSON.parse(row.days_of_week),
      startDate: row.start_date,
      endDate: row.end_date,
      startTime: row.start_time,
      endTime: row.end_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      classroom: row.classroom_id
        ? {
          id: row.classroom_id,
          buildingId: row.building_id,
          buildingName: row.building_name,
          floorId: row.floor_id,
          floorLabel: row.floor_label,
          regionId: row.region_id,
          roomNumber: row.room_number,
          name: row.classroom_name,
          capacity: row.capacity,
          facilities: JSON.parse(row.facilities_json)
        }
        : null
    };
  }

  const scheduleSelect = `
    SELECT s.*, c.building_id, b.name AS building_name, c.floor_id,
      f.label AS floor_label, c.region_id, c.room_number,
      c.name AS classroom_name, c.capacity, c.facilities_json
    FROM schedules s
    LEFT JOIN classrooms c ON c.id = s.classroom_id
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN floors f ON f.building_id = c.building_id AND f.id = c.floor_id
  `;

  function listSchedules(filters = {}) {
    const conditions = [];
    const values = [];
    if (filters.kind) {
      conditions.push('s.kind = ?');
      values.push(filters.kind);
    }
    if (filters.buildingId) {
      conditions.push('c.building_id = ?');
      values.push(filters.buildingId);
    }
    if (filters.floorId) {
      conditions.push('c.floor_id = ?');
      values.push(filters.floorId);
    }
    if (filters.classroomId) {
      conditions.push('s.classroom_id = ?');
      values.push(filters.classroomId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
      ${scheduleSelect} ${where}
      ORDER BY COALESCE(s.date, s.start_date), s.start_time, s.id
    `).all(...values).map(mapSchedule);
  }

  function getSchedule(id) {
    const row = db.prepare(`${scheduleSelect} WHERE s.id = ?`).get(id);
    return row ? mapSchedule(row) : null;
  }

  function recordActivity(actor, action, entityType, entityId, classroomId, previous, updated) {
    if (!actor || !Number.isSafeInteger(actor.id) || typeof actor.username !== 'string') {
      throw new TypeError('An authenticated user is required to record activity.');
    }
    db.prepare(`
      INSERT INTO activity_logs (
        actor_user_id, actor_username, action, entity_type, entity_id, classroom_id,
        previous_json, updated_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor.id,
      actor.username,
      action,
      entityType,
      entityId === null || entityId === undefined ? null : String(entityId),
      classroomId || null,
      previous === null || previous === undefined ? null : JSON.stringify(previous),
      updated === null || updated === undefined ? null : JSON.stringify(updated)
    );
  }

  function listActivityLogs(filters = {}) {
    const conditions = [];
    const values = [];
    if (filters.startAt) {
      conditions.push('a.created_at >= ?');
      values.push(filters.startAt);
    }
    if (filters.endAtExclusive) {
      conditions.push('a.created_at < ?');
      values.push(filters.endAtExclusive);
    }
    if (filters.action) {
      conditions.push('a.action = ?');
      values.push(filters.action);
    }
    const limit = filters.limit === undefined ? 100 : filters.limit;
    const offset = filters.offset === undefined ? 0 : filters.offset;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201 ||
        !Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError('Activity log pagination values are invalid.');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
      SELECT a.*, c.building_id, b.name AS building_name, c.floor_id,
        f.label AS floor_label, c.room_number, c.name AS classroom_name
      FROM activity_logs a
      LEFT JOIN classrooms c ON c.id = a.classroom_id
      LEFT JOIN buildings b ON b.id = c.building_id
      LEFT JOIN floors f ON f.building_id = c.building_id AND f.id = c.floor_id
      ${where}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset).map((row) => ({
      id: row.id,
      actorUsername: row.actor_username,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      classroomId: row.classroom_id,
      classroom: row.classroom_id
        ? {
          id: row.classroom_id,
          buildingName: row.building_name,
          floorId: row.floor_id,
          floorLabel: row.floor_label,
          roomNumber: row.room_number,
          name: row.classroom_name
        }
        : null,
      previous: row.previous_json ? JSON.parse(row.previous_json) : null,
      updated: row.updated_json ? JSON.parse(row.updated_json) : null,
      createdAt: row.created_at
    }));
  }

  function toRuleRecord(schedule) {
    return {
      id: schedule.id,
      classroomId: schedule.classroomId,
      recurrence: schedule.recurrence,
      date: schedule.date,
      daysOfWeek: schedule.daysOfWeek,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime
    };
  }

  function validateAndCheckConflict(input, excludeId) {
    const validated = validateScheduleInput(input);
    if (validated.classroomId) {
      const classroom = db.prepare('SELECT id FROM classrooms WHERE id = ?').get(validated.classroomId);
      if (!classroom) {
        throw new Error('The selected classroom does not exist in the room database.');
      }
      const existing = listSchedules()
        .filter((schedule) =>
          schedule.id !== excludeId &&
          schedule.classroomId === validated.classroomId
        );
      const conflict = existing.find((schedule) =>
        findScheduleOverlap(toRuleRecord(schedule), validated)
      );
      if (conflict) {
        const overlap = findScheduleOverlap(toRuleRecord(conflict), validated);
        const error = new Error('This classroom already has a schedule during the requested time.');
        error.status = 409;
        error.code = 'schedule_conflict';
        error.conflict = {
          existingSchedule: conflict,
          overlapPeriod: {
            date: overlap.date,
            startTime: overlap.startTime,
            endTime: overlap.endTime
          }
        };
        throw error;
      }
    }
    return validated;
  }

  function saveSchedule(input, id, actor) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const validated = validateAndCheckConflict(input, id);
      const previous = id ? getSchedule(id) : null;
      const values = [
        validated.kind,
        validated.course,
        validated.section,
        validated.instructor,
        validated.classroomId,
        validated.recurrence,
        validated.date,
        JSON.stringify(validated.daysOfWeek),
        validated.startDate,
        validated.endDate,
        validated.startTime,
        validated.endTime
      ];
      let scheduleId = id;
      if (id) {
        const result = db.prepare(`
          UPDATE schedules SET kind = ?, course = ?, section = ?, instructor = ?,
            classroom_id = ?, recurrence = ?, date = ?, days_of_week = ?,
            start_date = ?, end_date = ?, start_time = ?, end_time = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(...values, id);
        if (!result.changes) {
          throw Object.assign(new Error('Schedule not found.'), { status: 404 });
        }
      } else {
        const result = db.prepare(`
          INSERT INTO schedules (
            kind, course, section, instructor, classroom_id, recurrence, date,
            days_of_week, start_date, end_date, start_time, end_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...values);
        scheduleId = Number(result.lastInsertRowid);
      }
      const schedule = getSchedule(scheduleId);
      if (actor) {
        recordActivity(
          actor,
          id ? 'updated' : 'created',
          schedule.kind === 'reservation' ? 'reservation' : 'schedule',
          schedule.id,
          schedule.classroomId,
          previous,
          schedule
        );
      }
      db.exec('COMMIT');
      return schedule;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function deleteSchedule(id, actor) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = getSchedule(id);
      if (!previous) {
        db.exec('COMMIT');
        return false;
      }
      const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
      if (result.changes && actor) {
        recordActivity(
          actor,
          'deleted',
          previous.kind === 'reservation' ? 'reservation' : 'schedule',
          previous.id,
          previous.classroomId,
          previous,
          null
        );
      }
      db.exec('COMMIT');
      return result.changes > 0;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function getAvailability(filters) {
    const { date, startTime, endTime } = filters;
    if (!isValidDate(date) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime || '') ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime || '') ||
        startTime >= endTime) {
      throw Object.assign(
        new Error('Choose a valid date and a time range where the end is later than the start.'),
        { status: 400 }
      );
    }
    const rooms = listClassrooms(filters);
    const schedules = listSchedules();
    return rooms.map((classroom) => {
      const matching = schedules.filter((schedule) =>
        schedule.classroomId === classroom.id &&
        appliesOnDate(schedule, date) &&
        schedule.startTime < endTime &&
        schedule.endTime > startTime
      );
      const schedule = matching[0] || null;
      const status = !schedule
        ? 'available'
        : schedule.kind === 'reservation'
          ? 'reserved'
          : 'occupied';
      return {
        ...classroom,
        status,
        schedules: matching
      };
    });
  }

  function getConflicts(filters = {}) {
    const schedules = listSchedules().filter((schedule) => schedule.classroomId);
    const results = [];
    for (let leftIndex = 0; leftIndex < schedules.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < schedules.length; rightIndex += 1) {
        const existing = schedules[leftIndex];
        const conflicting = schedules[rightIndex];
        const overlap = findScheduleOverlap(toRuleRecord(existing), toRuleRecord(conflicting));
        if (!overlap) {
          continue;
        }
        if (filters.buildingId && existing.classroom.buildingId !== filters.buildingId) {
          continue;
        }
        if (filters.classroomId && existing.classroomId !== filters.classroomId) {
          continue;
        }
        if (filters.date && overlap.date !== filters.date) {
          continue;
        }
        results.push({
          id: `${existing.id}-${conflicting.id}`,
          status: 'unresolved',
          classroom: existing.classroom,
          existingSchedule: existing,
          conflictingSchedule: conflicting,
          overlapPeriod: overlap
        });
      }
    }
    return results;
  }

  function getDashboard(date = new Date().toISOString().slice(0, 10)) {
    const schedules = listSchedules({ kind: 'class' });
    const todaySchedules = schedules.filter((schedule) => appliesOnDate(schedule, date));
    const assignedClassrooms = new Set(
      schedules.filter((schedule) => schedule.classroomId).map((schedule) => schedule.classroomId)
    );
    const classrooms = listClassrooms();
    return {
      totalClassrooms: classrooms.length,
      totalScheduledClasses: schedules.length,
      totalAssignedClassrooms: assignedClassrooms.size,
      todaysClasses: todaySchedules.length,
      unassignedClasses: schedules.filter((schedule) => !schedule.classroomId).length,
      totalConflicts: getConflicts().length,
      availableClassrooms: getAvailability({
        date,
        startTime: '00:00',
        endTime: '23:59'
      }).filter((room) => room.status === 'available').length
    };
  }

  return {
    close: () => db.close(),
    createUser,
    createSession,
    deleteSchedule,
    deleteSession,
    findSession,
    getAvailability,
    getConflicts,
    getDashboard,
    getSchedule,
    getUser,
    listActivityLogs,
    listBuildings,
    listClassrooms,
    listSchedules,
    recordActivity,
    saveSchedule
  };
}

module.exports = { createDatabase };
