const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

// Load .env from project root when running locally (e.g. `npm start`) without
// overriding variables already set in the environment or by Docker Compose.
try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch {
  // .env is optional (not present inside the Docker container).
}
const { buildings } = require('../public/shared/js/roomq-data');
const { ROLES } = require('./permissions');
const {
  appliesOnDate,
  findScheduleOverlap,
  isValidDate,
  validateScheduleInput
} = require('./schedule-rules');

// Idempotent schema. Mirrors schema.sql; applied on every startup so the
// application self-initializes against an empty MySQL database (Docker or
// a freshly created test schema) without a separate migration step.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS buildings (
    id VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_buildings_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS floors (
    building_id VARCHAR(64) NOT NULL,
    id VARCHAR(32) NOT NULL,
    label VARCHAR(80) NOT NULL,
    crop_x DOUBLE NOT NULL,
    crop_y DOUBLE NOT NULL,
    crop_width DOUBLE NOT NULL,
    crop_height DOUBLE NOT NULL,
    PRIMARY KEY (building_id, id),
    CONSTRAINT fk_floors_building FOREIGN KEY (building_id)
      REFERENCES buildings (id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS classrooms (
    id VARCHAR(128) NOT NULL,
    building_id VARCHAR(64) NOT NULL,
    floor_id VARCHAR(32) NOT NULL,
    region_id VARCHAR(64) NOT NULL,
    room_number INT NULL DEFAULT NULL,
    name VARCHAR(120) NULL DEFAULT NULL,
    x DOUBLE NOT NULL,
    y DOUBLE NOT NULL,
    width DOUBLE NOT NULL,
    height DOUBLE NOT NULL,
    capacity INT UNSIGNED NULL DEFAULT NULL,
    facilities_json VARCHAR(2000) NOT NULL DEFAULT ('[]'),
    PRIMARY KEY (id),
    UNIQUE KEY uq_classrooms_region (building_id, floor_id, region_id),
    CONSTRAINT fk_classrooms_floor FOREIGN KEY (building_id, floor_id)
      REFERENCES floors (building_id, id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(60) NULL DEFAULT NULL,
    middle_name VARCHAR(60) NULL DEFAULT NULL,
    last_name VARCHAR(60) NULL DEFAULT NULL,
    full_name VARCHAR(190) NULL DEFAULT NULL,
    email VARCHAR(190) NULL DEFAULT NULL,
    password_salt VARCHAR(64) NOT NULL,
    password_hash VARCHAR(128) NOT NULL,
    role ENUM('admin', 'staff', 'user') NOT NULL DEFAULT 'user',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role_active (role, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (token_hash),
    KEY idx_auth_sessions_user (user_id),
    KEY idx_auth_sessions_expiry (expires_at),
    CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS schedules (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    kind ENUM('class', 'reservation') NOT NULL,
    course VARCHAR(120) NOT NULL DEFAULT '',
    section VARCHAR(64) NOT NULL DEFAULT '',
    instructor VARCHAR(120) NOT NULL DEFAULT '',
    classroom_id VARCHAR(128) NULL DEFAULT NULL,
    recurrence ENUM('once', 'weekly') NOT NULL,
    date DATE NULL DEFAULT NULL,
    days_of_week VARCHAR(64) NOT NULL DEFAULT ('[]'),
    start_date DATE NULL DEFAULT NULL,
    end_date DATE NULL DEFAULT NULL,
    start_time CHAR(5) NOT NULL,
    end_time CHAR(5) NOT NULL,
    created_by_user_id INT UNSIGNED NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_schedules_classroom (classroom_id),
    KEY idx_schedules_dates (date, start_date, end_date),
    KEY idx_schedules_created_by (created_by_user_id),
    CONSTRAINT fk_schedules_classroom FOREIGN KEY (classroom_id)
      REFERENCES classrooms (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_schedules_created_by FOREIGN KEY (created_by_user_id)
      REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_schedules_time_order CHECK (start_time < end_time),
    CONSTRAINT chk_schedules_recurrence CHECK (
      (recurrence = 'once' AND date IS NOT NULL AND start_date IS NULL AND end_date IS NULL)
      OR
      (recurrence = 'weekly' AND date IS NULL AND start_date IS NOT NULL)
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id INT UNSIGNED NULL DEFAULT NULL,
    actor_email VARCHAR(190) NOT NULL,
    action ENUM('created', 'updated', 'deleted', 'registered', 'signed_in', 'signed_out') NOT NULL,
    entity_type ENUM('schedule', 'reservation', 'user', 'session') NOT NULL,
    entity_id VARCHAR(64) NULL DEFAULT NULL,
    classroom_id VARCHAR(128) NULL DEFAULT NULL,
    previous_json LONGTEXT NULL DEFAULT NULL,
    updated_json LONGTEXT NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_activity_logs_created (created_at, id),
    KEY idx_activity_logs_actor (actor_email),
    KEY idx_activity_logs_user (actor_user_id),
    KEY idx_activity_logs_classroom (classroom_id),
    CONSTRAINT fk_activity_logs_user FOREIGN KEY (actor_user_id)
      REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_activity_logs_classroom FOREIGN KEY (classroom_id)
      REFERENCES classrooms (id) ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

function readEnvConfig() {
  return {
    host: process.env.ROOMQ_DB_HOST || '127.0.0.1',
    port: Number(process.env.ROOMQ_DB_PORT || process.env.MYSQL_HOST_PORT) || 3306,
    user: process.env.ROOMQ_DB_USER || 'roomq',
    password: process.env.ROOMQ_DB_PASSWORD || '',
    database: process.env.ROOMQ_DB_NAME || 'roomq'
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait for the MySQL server to accept connections. In Docker the backend can
// start before the database is ready even with a healthcheck, so retry.
async function waitForServer(connectionConfig, { attempts = 30, delayMs = 2000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const connection = await mysql.createConnection(connectionConfig);
      await connection.end();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw new Error(`Could not connect to MySQL at ${connectionConfig.host}:${connectionConfig.port} - ${lastError.message}`);
}

async function createDatabase(options = {}) {
  const config = { ...readEnvConfig(), ...options };
  const { host, port, user, password, database } = config;
  const serverConfig = { host, port, user, password, multipleStatements: false };

  await waitForServer(serverConfig, {
    attempts: options.connectAttempts || Number(process.env.ROOMQ_DB_CONNECT_ATTEMPTS) || 30,
    delayMs: options.connectDelayMs || 2000
  });

  // Ensure the target database exists before pooling against it.
  const bootstrap = await mysql.createConnection(serverConfig);
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  await bootstrap.end();

  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.ROOMQ_DB_POOL_SIZE) || 10,
    multipleStatements: false,
    dateStrings: true,
    charset: 'utf8mb4_unicode_ci'
  });

  for (const statement of SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }

  // Databases created before staff accounts existed have a users table whose
  // role column only allows admin/user and which lacks the profile and status
  // columns. Existing rows (and their roles) are preserved; new columns get
  // safe defaults, so every existing account stays active.
  const [roleColumn] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  if (roleColumn.length && !roleColumn[0].COLUMN_TYPE.includes("'staff'")) {
    await pool.query(
      "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'staff', 'user') NOT NULL DEFAULT 'user'"
    );
  }
  const [profileColumns] = await pool.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME IN ('username', 'first_name', 'middle_name', 'last_name', 'full_name', 'email', 'is_active', 'updated_at')`
  );
  const columnMap = new Map(profileColumns.map((column) => [column.COLUMN_NAME, column]));
  const userAlterations = [];
  if (!columnMap.has('first_name')) {
    userAlterations.push('ADD COLUMN first_name VARCHAR(60) NULL DEFAULT NULL');
  }
  if (!columnMap.has('middle_name')) {
    userAlterations.push('ADD COLUMN middle_name VARCHAR(60) NULL DEFAULT NULL');
  }
  if (!columnMap.has('last_name')) {
    userAlterations.push('ADD COLUMN last_name VARCHAR(60) NULL DEFAULT NULL');
  }
  const fullNameCol = columnMap.get('full_name');
  if (!fullNameCol) {
    userAlterations.push('ADD COLUMN full_name VARCHAR(190) NULL DEFAULT NULL');
  } else if (Number(fullNameCol.CHARACTER_MAXIMUM_LENGTH) < 190) {
    userAlterations.push('MODIFY COLUMN full_name VARCHAR(190) NULL DEFAULT NULL');
  }
  if (!columnMap.has('email')) userAlterations.push('ADD COLUMN email VARCHAR(190) NULL DEFAULT NULL');
  if (!columnMap.has('is_active')) userAlterations.push('ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
  if (!columnMap.has('updated_at')) {
    userAlterations.push('ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  }
  if (userAlterations.length) {
    await pool.query(`ALTER TABLE users ${userAlterations.join(', ')}`);
  }
  // Accounts are identified by email only. Databases that still have the old
  // username column get an email (and name) for every row, then lose the column.
  if (columnMap.has('username')) {
    const adminEmail = String(process.env.ROOMQ_ADMIN_EMAIL || '').trim().toLowerCase();
    const [legacyRows] = await pool.query(
      'SELECT id, username, role, email, first_name FROM users ORDER BY id'
    );
    let adminAssigned = false;
    for (const row of legacyRows) {
      let email = row.email;
      if (!email) {
        if (row.role === 'admin' && adminEmail && !adminAssigned) {
          email = adminEmail;
        } else {
          email = `${String(row.username || `user${row.id}`).toLowerCase()}@roomq.local`;
        }
      }
      if (row.role === 'admin') adminAssigned = true;
      const isAdmin = row.role === 'admin';
      const firstName = row.first_name || (isAdmin ? 'System' : row.username);
      const lastName = isAdmin ? 'Administrator' : null;
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      await pool.query(
        `UPDATE users SET email = ?, first_name = COALESCE(first_name, ?),
           last_name = COALESCE(last_name, ?), full_name = COALESCE(full_name, ?) WHERE id = ?`,
        [email, firstName, lastName, fullName, row.id]
      );
    }
    await pool.query('ALTER TABLE users DROP COLUMN username');
  }
  const [actorCol] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_logs' AND COLUMN_NAME = 'actor_username'`
  );
  if (actorCol.length) {
    await pool.query(
      'ALTER TABLE activity_logs CHANGE COLUMN actor_username actor_email VARCHAR(190) NOT NULL'
    );
    await pool.query(
      `UPDATE activity_logs a JOIN users u ON u.id = a.actor_user_id
       SET a.actor_email = u.email WHERE u.email IS NOT NULL`
    );
  }
  const [userIndexes] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND INDEX_NAME IN ('uq_users_email', 'idx_users_role_active')`
  );
  const presentIndexes = new Set(userIndexes.map((index) => index.INDEX_NAME));
  if (!presentIndexes.has('uq_users_email')) {
    await pool.query('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
  }
  if (!presentIndexes.has('idx_users_role_active')) {
    await pool.query('ALTER TABLE users ADD KEY idx_users_role_active (role, is_active)');
  }

  // Databases created before reservations recorded their owner lack this
  // column; CREATE TABLE IF NOT EXISTS does not alter existing tables.
  const [ownerColumn] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedules'
       AND COLUMN_NAME = 'created_by_user_id'`
  );
  if (!ownerColumn.length) {
    await pool.query(`
      ALTER TABLE schedules
        ADD COLUMN created_by_user_id INT UNSIGNED NULL DEFAULT NULL AFTER end_time,
        ADD KEY idx_schedules_created_by (created_by_user_id),
        ADD CONSTRAINT fk_schedules_created_by FOREIGN KEY (created_by_user_id)
          REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }

  const run = async (sql, values = [], executor = pool) => {
    const [result] = await executor.execute(sql, values);
    return result;
  };
  const all = async (sql, values = [], executor = pool) => {
    const [rows] = await executor.execute(sql, values);
    return rows;
  };
  const get = async (sql, values = [], executor = pool) => {
    const rows = await all(sql, values, executor);
    return rows[0];
  };

  await seedBuildings();
  await seedAdmin(options);

  async function seedBuildings() {
    const expectedBuildingIds = new Set();
    const expectedFloorIds = new Set();
    const expectedClassroomIds = new Set();

    for (const building of buildings) {
      expectedBuildingIds.add(building.id);
      await run(
        'INSERT INTO buildings (id, name) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE name = VALUES(name)',
        [building.id, building.name]
      );
      for (const floor of building.floors) {
        expectedFloorIds.add(`${building.id}:${floor.id}`);
        await run(
          `INSERT INTO floors (building_id, id, label, crop_x, crop_y, crop_width, crop_height)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             label = VALUES(label), crop_x = VALUES(crop_x), crop_y = VALUES(crop_y),
             crop_width = VALUES(crop_width), crop_height = VALUES(crop_height)`,
          [building.id, floor.id, floor.label, floor.crop.x, floor.crop.y,
            floor.crop.width, floor.crop.height]
        );
        let index = 0;
        for (const region of floor.regions) {
          const roomNumber = region.roomNumber !== undefined
            ? region.roomNumber
            : Number(floor.id) * 100 + index + 1;
          const classroomId = `${building.id}-${floor.id}-${region.id}`;
          expectedClassroomIds.add(classroomId);
          await run(
            `INSERT INTO classrooms
               (id, building_id, floor_id, region_id, room_number, name, x, y, width, height)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               building_id = VALUES(building_id), floor_id = VALUES(floor_id),
               region_id = VALUES(region_id), room_number = VALUES(room_number),
               name = VALUES(name), x = VALUES(x), y = VALUES(y),
               width = VALUES(width), height = VALUES(height)`,
            [classroomId, building.id, floor.id, region.id,
              Number.isInteger(roomNumber) ? roomNumber : null,
              region.name || null, region.x, region.y, region.width, region.height]
          );
          index += 1;
        }
      }
    }

    // Prune anything no longer present in the mapped layout.
    for (const row of await all('SELECT id FROM classrooms')) {
      if (!expectedClassroomIds.has(row.id)) {
        await run('UPDATE schedules SET classroom_id = NULL WHERE classroom_id = ?', [row.id]);
        await run('DELETE FROM classrooms WHERE id = ?', [row.id]);
      }
    }
    for (const row of await all('SELECT building_id, id FROM floors')) {
      if (!expectedFloorIds.has(`${row.building_id}:${row.id}`)) {
        await run('DELETE FROM floors WHERE building_id = ? AND id = ?', [row.building_id, row.id]);
      }
    }
    for (const row of await all('SELECT id FROM buildings')) {
      if (!expectedBuildingIds.has(row.id)) {
        await run('DELETE FROM buildings WHERE id = ?', [row.id]);
      }
    }
  }

  async function seedAdmin({ adminEmail: seedEmail, adminPassword: seedPassword } = {}) {
    const existing = await get('SELECT id FROM users LIMIT 1');
    if (existing) {
      return;
    }
    const adminEmail = String(seedEmail || process.env.ROOMQ_ADMIN_EMAIL || 'admin@roomq.local')
      .trim().toLowerCase();
    const adminPassword = seedPassword || process.env.ROOMQ_ADMIN_PASSWORD;
    if (!adminPassword || adminPassword.length < 8) {
      throw new Error('Set ROOMQ_ADMIN_PASSWORD to a password of at least 8 characters before starting RoomQ.');
    }
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(adminPassword, salt, 64);
    await run(
      `INSERT INTO users (first_name, last_name, full_name, email, password_salt, password_hash, role)
       VALUES ('System', 'Administrator', 'System Administrator', ?, ?, ?, 'admin')`,
      [adminEmail, salt.toString('hex'), hash.toString('hex')]
    );
  }

  const USER_FIELDS =
    'id, first_name, middle_name, last_name, password_salt, password_hash, role, full_name, email, is_active, created_at, updated_at';

  function composeFullName({ firstName, middleName, lastName, fullName } = {}) {
    if (firstName || lastName) {
      const joined = [firstName, middleName, lastName]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(' ');
      if (joined) return joined;
    }
    return typeof fullName === 'string' && fullName.trim() ? fullName.trim() : null;
  }

  // Account details that are safe to send to a browser (never the password).
  function mapUser(row) {
    const fullName = composeFullName({
      firstName: row.first_name,
      middleName: row.middle_name,
      lastName: row.last_name,
      fullName: row.full_name
    });
    return {
      id: row.id,
      firstName: row.first_name || null,
      middleName: row.middle_name || null,
      lastName: row.last_name || null,
      fullName,
      email: row.email,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // What the audit trail keeps about an account: details, never credentials.
  const userSnapshot = (user) => ({
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    isActive: user.isActive
  });

  function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    return {
      salt: salt.toString('hex'),
      hash: crypto.scryptSync(password, salt, 64).toString('hex')
    };
  }

  const conflictError = (message) => Object.assign(new Error(message), { status: 409 });
  const notFoundError = () => Object.assign(new Error('User not found.'), { status: 404 });

  // Turns MySQL's duplicate-key error into a friendly 409 naming the field.
  function duplicateUserError(error) {
    if (error.code !== 'ER_DUP_ENTRY') return error;
    return conflictError('That email address is already in use.');
  }

  async function getUserByEmail(email) {
    if (!email) return undefined;
    return get(`SELECT ${USER_FIELDS} FROM users WHERE email = ? LIMIT 1`, [email]);
  }

  async function getUserById(id, executor = pool) {
    const row = await get(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id], executor);
    return row ? mapUser(row) : null;
  }

  async function createUser({ email, password, role = 'user', ...profile }) {
    if (!ROLES.includes(role)) {
      throw new Error('User role is invalid.');
    }
    const { salt, hash } = hashPassword(password);
    const firstName = profile.firstName || null;
    const middleName = profile.middleName || null;
    const lastName = profile.lastName || null;
    const fullName = composeFullName({
      firstName,
      middleName,
      lastName,
      fullName: profile.fullName
    });
    let insertId;
    try {
      const result = await run(
        `INSERT INTO users (first_name, middle_name, last_name, password_salt, password_hash, role, full_name, email, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [firstName, middleName, lastName, salt, hash, role, fullName, email || null,
          profile.isActive === false ? 0 : 1]
      );
      insertId = Number(result.insertId);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return null; // email already registered
      }
      throw error;
    }
    return get(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [insertId]);
  }

  async function listUsers({ q, role, status } = {}) {
    const conditions = [];
    const values = [];
    if (q) {
      const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push('(first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR full_name LIKE ? OR email LIKE ?)');
      values.push(like, like, like, like, like);
    }
    if (role) {
      conditions.push('role = ?');
      values.push(role);
    }
    if (status === 'active' || status === 'inactive') {
      conditions.push('is_active = ?');
      values.push(status === 'active' ? 1 : 0);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await all(
      `SELECT ${USER_FIELDS} FROM users ${where} ORDER BY is_active DESC, role, email`,
      values
    );
    return rows.map(mapUser);
  }

  // Runs `work` in a transaction that first locks every active administrator
  // row, so concurrent changes cannot each believe another admin remains.
  async function withAdminGuard(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const admins = await all(
        "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id FOR UPDATE", [], connection
      );
      const result = await work(connection, admins.length);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw duplicateUserError(error);
    } finally {
      connection.release();
    }
  }

  // Administrator edit of any account: profile, role, status, optional new
  // password. Refuses to leave the system without an active administrator.
  async function updateUser(id, changes, actor) {
    return withAdminGuard(async (connection, activeAdmins) => {
      const row = await get(`SELECT ${USER_FIELDS} FROM users WHERE id = ? FOR UPDATE`, [id], connection);
      if (!row) throw notFoundError();
      const previous = mapUser(row);
      const firstName = changes.firstName !== undefined ? changes.firstName : previous.firstName;
      const middleName = changes.middleName !== undefined ? changes.middleName : previous.middleName;
      const lastName = changes.lastName !== undefined ? changes.lastName : previous.lastName;
      const hasNameParts = changes.firstName !== undefined || changes.middleName !== undefined || changes.lastName !== undefined;
      const next = {
        firstName,
        middleName,
        lastName,
        fullName: hasNameParts
          ? composeFullName({ firstName, middleName, lastName, fullName: changes.fullName })
          : (changes.fullName !== undefined ? changes.fullName : previous.fullName),
        email: changes.email !== undefined ? changes.email : previous.email,
        role: changes.role !== undefined ? changes.role : previous.role,
        isActive: changes.isActive !== undefined ? changes.isActive : previous.isActive
      };
      if (!ROLES.includes(next.role)) throw Object.assign(new Error('User role is invalid.'), { status: 400 });
      if (!next.email) throw Object.assign(new Error('Every account needs an email address.'), { status: 400 });
      const wasActiveAdmin = previous.role === 'admin' && previous.isActive;
      const staysActiveAdmin = next.role === 'admin' && next.isActive;
      if (wasActiveAdmin && !staysActiveAdmin && activeAdmins <= 1) {
        throw conflictError('RoomQ must keep at least one active administrator. Make another account an administrator first.');
      }
      const sets = ['first_name = ?', 'middle_name = ?', 'last_name = ?', 'full_name = ?', 'email = ?', 'role = ?', 'is_active = ?'];
      const values = [next.firstName, next.middleName, next.lastName, next.fullName, next.email, next.role, next.isActive ? 1 : 0];
      if (changes.password) {
        const { salt, hash } = hashPassword(changes.password);
        sets.push('password_salt = ?', 'password_hash = ?');
        values.push(salt, hash);
      }
      await run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, id], connection);
      // Deactivation and password resets end the account's open sessions.
      if ((previous.isActive && !next.isActive) || changes.password) {
        await run('DELETE FROM auth_sessions WHERE user_id = ?', [id], connection);
      }
      const updated = await getUserById(id, connection);
      if (actor) {
        await recordActivity(
          actor, 'updated', 'user', id, null,
          userSnapshot(previous),
          { ...userSnapshot(updated), ...(changes.password ? { passwordReset: true } : {}) },
          connection
        );
      }
      return updated;
    });
  }

  async function deleteUser(id, actor) {
    return withAdminGuard(async (connection, activeAdmins) => {
      const row = await get(`SELECT ${USER_FIELDS} FROM users WHERE id = ? FOR UPDATE`, [id], connection);
      if (!row) throw notFoundError();
      const previous = mapUser(row);
      if (previous.role === 'admin' && previous.isActive && activeAdmins <= 1) {
        throw conflictError('RoomQ must keep at least one active administrator. This account cannot be deleted.');
      }
      await run('DELETE FROM users WHERE id = ?', [id], connection);
      if (actor) {
        await recordActivity(actor, 'deleted', 'user', id, null, userSnapshot(previous), null, connection);
      }
      return previous;
    });
  }

  // A signed-in account editing its own name and email. Role and status are
  // deliberately not accepted here.
  async function updateOwnProfile(id, { firstName, middleName, lastName, fullName, email }) {
    const previous = await getUserById(id);
    if (!previous) throw notFoundError();
    const nextFirst = firstName !== undefined ? firstName : previous.firstName;
    const nextMiddle = middleName !== undefined ? middleName : previous.middleName;
    const nextLast = lastName !== undefined ? lastName : previous.lastName;
    const hasNameParts = firstName !== undefined || middleName !== undefined || lastName !== undefined;
    const nextFull = hasNameParts
      ? composeFullName({ firstName: nextFirst, middleName: nextMiddle, lastName: nextLast, fullName })
      : (fullName !== undefined ? fullName : previous.fullName);
    try {
      await run(
        'UPDATE users SET first_name = ?, middle_name = ?, last_name = ?, full_name = ?, email = ? WHERE id = ?',
        [nextFirst, nextMiddle, nextLast, nextFull, email, id]
      );
    } catch (error) {
      throw duplicateUserError(error);
    }
    const updated = await getUserById(id);
    await recordActivity(
      { id: updated.id, email: updated.email }, 'updated', 'user', id, null,
      userSnapshot(previous), userSnapshot(updated)
    );
    return updated;
  }

  // Sets a new password and signs the account out everywhere except the
  // session that made the change.
  async function changePassword(id, newPassword, keepTokenHash) {
    const { salt, hash } = hashPassword(newPassword);
    await run('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?', [salt, hash, id]);
    await run(
      'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?',
      [id, keepTokenHash || '']
    );
    const user = await getUserById(id);
    await recordActivity(
      { id: user.id, email: user.email }, 'updated', 'user', id, null,
      null, { passwordChanged: true }
    );
  }

  async function createSession(userId, tokenHash, expiresAt) {
    await run(
      'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [tokenHash, userId, expiresAt]
    );
  }

  async function findSession(tokenHash) {
    const now = Date.now();
    await run('DELETE FROM auth_sessions WHERE expires_at <= ?', [now]);
    // Role and status are read from the database on every request, so a role
    // change or deactivation takes effect immediately, not at next sign-in.
    const row = await get(
      `SELECT u.id, u.first_name, u.middle_name, u.last_name, u.role, u.full_name, u.email
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
      [tokenHash, now]
    );
    return row
      ? {
        id: row.id,
        firstName: row.first_name || null,
        middleName: row.middle_name || null,
        lastName: row.last_name || null,
        role: row.role,
        fullName: composeFullName({
          firstName: row.first_name,
          middleName: row.middle_name,
          lastName: row.last_name,
          fullName: row.full_name
        }),
        email: row.email
      }
      : undefined;
  }

  async function deleteSession(tokenHash) {
    await run('DELETE FROM auth_sessions WHERE token_hash = ?', [tokenHash]);
  }

  async function listBuildings() {
    const rows = await all(`
      SELECT b.id AS building_id, b.name AS building_name,
        f.id AS floor_id, f.label AS floor_label
      FROM buildings b LEFT JOIN floors f ON f.building_id = b.id
      ORDER BY b.name, CAST(f.id AS UNSIGNED)
    `);
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

  async function listClassrooms(filters = {}, executor = pool) {
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
    const rows = await all(`
      SELECT c.*, b.name AS building_name, f.label AS floor_label
      FROM classrooms c
      JOIN buildings b ON b.id = c.building_id
      JOIN floors f ON f.building_id = c.building_id AND f.id = c.floor_id
      ${where}
      ORDER BY b.name, CAST(c.floor_id AS UNSIGNED), c.room_number, c.name
    `, values, executor);
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
      createdByUserId: row.created_by_user_id,
      createdByEmail: row.created_by_email,
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
      c.name AS classroom_name, c.capacity, c.facilities_json,
      u.email AS created_by_email
    FROM schedules s
    LEFT JOIN users u ON u.id = s.created_by_user_id
    LEFT JOIN classrooms c ON c.id = s.classroom_id
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN floors f ON f.building_id = c.building_id AND f.id = c.floor_id
  `;

  async function listSchedules(filters = {}, executor = pool) {
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
    if (filters.createdByUserId) {
      conditions.push('s.created_by_user_id = ?');
      values.push(filters.createdByUserId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // `lock` turns this into a current (locking) read of the schedule rows so a
    // transaction sees bookings committed after it started.
    const rows = await all(`
      ${scheduleSelect} ${where}
      ORDER BY COALESCE(s.date, s.start_date), s.start_time, s.id
      ${filters.lock ? 'FOR UPDATE OF s' : ''}
    `, values, executor);
    return rows.map(mapSchedule);
  }

  async function getSchedule(id, executor = pool) {
    const row = await get(`${scheduleSelect} WHERE s.id = ?`, [id], executor);
    return row ? mapSchedule(row) : null;
  }

  async function recordActivity(actor, action, entityType, entityId, classroomId, previous, updated, executor = pool) {
    if (!actor || !Number.isSafeInteger(actor.id) || typeof actor.email !== 'string') {
      throw new TypeError('An authenticated user is required to record activity.');
    }
    await run(`
      INSERT INTO activity_logs (
        actor_user_id, actor_email, action, entity_type, entity_id, classroom_id,
        previous_json, updated_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      actor.id,
      actor.email,
      action,
      entityType,
      entityId === null || entityId === undefined ? null : String(entityId),
      classroomId || null,
      previous === null || previous === undefined ? null : JSON.stringify(previous),
      updated === null || updated === undefined ? null : JSON.stringify(updated)
    ], executor);
  }

  async function listActivityLogs(filters = {}) {
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
    // limit/offset are validated safe integers; inlined because MySQL prepared
    // statements reject bound LIMIT/OFFSET placeholders.
    const rows = await all(`
      SELECT a.*, c.building_id, b.name AS building_name, c.floor_id,
        f.label AS floor_label, c.room_number, c.name AS classroom_name
      FROM activity_logs a
      LEFT JOIN classrooms c ON c.id = a.classroom_id
      LEFT JOIN buildings b ON b.id = c.building_id
      LEFT JOIN floors f ON f.building_id = c.building_id AND f.id = c.floor_id
      ${where}
      ORDER BY a.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `, values);
    return rows.map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
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

  async function validateAndCheckConflict(input, excludeId, executor) {
    const validated = validateScheduleInput(input);
    if (validated.classroomId) {
      // Lock the classroom row before anything else in the transaction. Every
      // booking for this room takes the same lock, so concurrent bookings are
      // serialized: the second waits until the first commits or rolls back.
      const classroom = await get(
        'SELECT id FROM classrooms WHERE id = ? FOR UPDATE', [validated.classroomId], executor
      );
      if (!classroom) {
        throw Object.assign(
          new Error('The selected classroom does not exist in the room database.'),
          { status: 400 }
        );
      }
      // Locking (current) read, so bookings committed by a transaction we just
      // waited on are visible here rather than hidden by a stale snapshot.
      const existing = (await listSchedules(
        { classroomId: validated.classroomId, lock: true }, executor
      )).filter((schedule) => schedule.id !== excludeId);
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

  async function saveSchedule(input, id, actor) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const validated = await validateAndCheckConflict(input, id, connection);
      const previous = id ? await getSchedule(id, connection) : null;
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
        const result = await run(`
          UPDATE schedules SET kind = ?, course = ?, section = ?, instructor = ?,
            classroom_id = ?, recurrence = ?, date = ?, days_of_week = ?,
            start_date = ?, end_date = ?, start_time = ?, end_time = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [...values, id], connection);
        if (!result.affectedRows) {
          throw Object.assign(new Error('Schedule not found.'), { status: 404 });
        }
      } else {
        const result = await run(`
          INSERT INTO schedules (
            kind, course, section, instructor, classroom_id, recurrence, date,
            days_of_week, start_date, end_date, start_time, end_time, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [...values, actor && Number.isSafeInteger(actor.id) ? actor.id : null], connection);
        scheduleId = Number(result.insertId);
      }
      const schedule = await getSchedule(scheduleId, connection);
      if (actor) {
        await recordActivity(
          actor,
          id ? 'updated' : 'created',
          schedule.kind === 'reservation' ? 'reservation' : 'schedule',
          schedule.id,
          schedule.classroomId,
          previous,
          schedule,
          connection
        );
      }
      await connection.commit();
      return schedule;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function deleteSchedule(id, actor) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const previous = await getSchedule(id, connection);
      if (!previous) {
        await connection.commit();
        return false;
      }
      const result = await run('DELETE FROM schedules WHERE id = ?', [id], connection);
      if (result.affectedRows && actor) {
        await recordActivity(
          actor,
          'deleted',
          previous.kind === 'reservation' ? 'reservation' : 'schedule',
          previous.id,
          previous.classroomId,
          previous,
          null,
          connection
        );
      }
      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Reservations owned by a user that have not yet ended (date on/after today).
  async function countActiveReservations(userId, today, excludeId = null) {
    const row = await get(`
      SELECT COUNT(*) AS total FROM schedules
      WHERE kind = 'reservation' AND created_by_user_id = ?
        AND COALESCE(end_date, date, start_date) >= ?
        AND (? IS NULL OR id <> ?)
    `, [userId, today, excludeId, excludeId]);
    return Number(row.total);
  }

  async function getAvailability(filters) {
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
    const rooms = await listClassrooms(filters);
    const schedules = await listSchedules();
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

  async function getConflicts(filters = {}) {
    const schedules = (await listSchedules()).filter((schedule) => schedule.classroomId);
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

  async function getDashboard(date = new Date().toISOString().slice(0, 10)) {
    const schedules = await listSchedules({ kind: 'class' });
    const todaySchedules = schedules.filter((schedule) => appliesOnDate(schedule, date));
    const assignedClassrooms = new Set(
      schedules.filter((schedule) => schedule.classroomId).map((schedule) => schedule.classroomId)
    );
    const classrooms = await listClassrooms();
    const [conflicts, availability] = await Promise.all([
      getConflicts(),
      getAvailability({ date, startTime: '00:00', endTime: '23:59' })
    ]);
    return {
      totalClassrooms: classrooms.length,
      totalScheduledClasses: schedules.length,
      totalAssignedClassrooms: assignedClassrooms.size,
      todaysClasses: todaySchedules.length,
      unassignedClasses: schedules.filter((schedule) => !schedule.classroomId).length,
      totalConflicts: conflicts.length,
      availableClassrooms: availability.filter((room) => room.status === 'available').length
    };
  }

  return {
    close: () => pool.end(),
    changePassword,
    countActiveReservations,
    createUser,
    createSession,
    deleteSchedule,
    deleteSession,
    deleteUser,
    findSession,
    getAvailability,
    getConflicts,
    getDashboard,
    getSchedule,
    getUserByEmail,
    getUserById,
    listActivityLogs,
    listBuildings,
    listClassrooms,
    listSchedules,
    listUsers,
    recordActivity,
    saveSchedule,
    updateOwnProfile,
    updateUser
  };
}

module.exports = { createDatabase, readEnvConfig };
