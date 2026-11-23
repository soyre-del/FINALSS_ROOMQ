PRAGMA foreign_keys = ON;

CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE floors (
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  crop_x REAL NOT NULL,
  crop_y REAL NOT NULL,
  crop_width REAL NOT NULL,
  crop_height REAL NOT NULL,
  PRIMARY KEY (building_id, id)
);

CREATE TABLE classrooms (
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
  FOREIGN KEY (building_id, floor_id)
    REFERENCES floors(building_id, id) ON DELETE CASCADE
);

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

CREATE TABLE schedules (
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

CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('created', 'updated', 'deleted', 'registered', 'signed_in', 'signed_out')
  ),
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('schedule', 'reservation', 'user', 'session')
  ),
  entity_id TEXT,
  classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
  previous_json TEXT,
  updated_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX schedules_classroom_idx ON schedules(classroom_id);
CREATE INDEX schedules_date_idx ON schedules(date, start_date, end_date);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE INDEX activity_logs_created_idx ON activity_logs(created_at, id);
CREATE INDEX activity_logs_actor_idx ON activity_logs(actor_username);
