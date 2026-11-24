# RoomQ

RoomQ is a Node.js-served classroom scheduling and availability application. Its
room inventory and plan coordinates come from the mapped layouts in
`public/shared/js/roomq-data.js`; schedules, reservations, users, sessions, and
the audit trail are stored in **MySQL**. The full stack (database + backend)
runs with **Docker Compose**.

## Project layout

- `src/` — the Node.js HTTP server (`server.js`), MySQL data access
  (`roomq-db.js`), and schedule rules (`schedule-rules.js`).
- `public/` — HTML, CSS, browser scripts, and image assets (admin + user areas).
- `tests/` — the Node.js test suite (runs against a MySQL server).
- `schema.sql` — a stand-alone, importable MySQL schema + seed (reference /
  manual import). The app also creates and seeds these tables automatically on
  startup, so Docker users do not need to import it.
- `Dockerfile`, `docker-compose.yml`, `.env.example` — containerization.

## Architecture

- **Backend:** vanilla Node.js `http` server — routing, static file serving,
  cookie sessions, rate limiting, and security headers. The only runtime
  dependency is `mysql2`.
- **Database:** MySQL 8 (InnoDB, `utf8mb4`), accessed through a `mysql2`
  connection pool. Writes that must stay consistent (booking a room) run inside
  a transaction with `SELECT ... FOR UPDATE` row locks so two concurrent
  bookings cannot both pass the conflict check.
- **Schema management:** the schema is defined in source (`src/roomq-db.js`) and
  applied idempotently on every startup (`CREATE TABLE IF NOT EXISTS`), then the
  room inventory is seeded from `roomq-data.js` (the single source of truth) and
  rooms no longer present in the layout are pruned.
- **Frontend:** static pages that talk to the backend only through the JSON API.

### Tables

| Table | Purpose |
|-------|---------|
| `buildings` | Campus buildings. |
| `floors` | Floors per building (PK `building_id, id`; FK → `buildings`). |
| `classrooms` | Rooms with map coordinates (FK → `floors`). |
| `users` | Accounts with `role` (`admin` / `staff` / `faculty` / `student`), profile (names, email), AES-encrypted school ID, `is_active` status and salted scrypt passwords. |
| `auth_sessions` | Hashed session tokens with expiry (FK → `users`). |
| `schedules` | Classes and reservations (FK → `classrooms`), with recurrence and time-order `CHECK` constraints. |
| `activity_logs` | Audit trail of every create/update/delete/sign-in (FKs → `users`, `classrooms`). |

## Run with Docker (recommended)

Requires Docker and Docker Compose.

```powershell
# 1. Create your private environment file and fill in the values.
Copy-Item .env.example .env
#    Edit .env: set strong MYSQL_ROOT_PASSWORD, ROOMQ_DB_PASSWORD,
#    ROOMQ_ADMIN_PASSWORD (>= 12 chars) and ROOMQ_ADMIN_SIGNUP_KEY (>= 16 chars).

# 2. Build images and start the database + backend.
docker compose up -d --build

# 3. Open the app.
#    http://localhost:8080   (BACKEND_HOST_PORT in .env)
```

Sign in with the administrator account from `.env` (`ROOMQ_ADMIN_EMAIL` /
`ROOMQ_ADMIN_PASSWORD`). The shared sign-in page accepts either an administrator
or a user account and routes each appropriately. New accounts created there are
user accounts (they can reserve classrooms); class-schedule management is
administrator-only.

### Container commands

```powershell
docker compose up -d --build      # start / rebuild and start (npm run up)
docker compose down               # stop and remove containers (npm run down)
docker compose down -v            # also delete the database volume (wipes data)
docker compose restart            # restart both services
docker compose up -d --build backend   # rebuild only the backend (npm run rebuild)
docker compose logs -f backend    # follow backend logs (npm run logs)
docker compose ps                 # show service status
```

Database records are stored in the `roomq-db-data` named volume and survive
`docker compose down` and container restarts. They are removed only by
`docker compose down -v`.

### Accessing the MySQL database

The database is published on the host at `MYSQL_HOST_PORT` (default `3307`):

```powershell
# From inside the container:
docker exec -it roomq-db mysql -uroomq -p roomq

# From the host (any MySQL client / Workbench):
#   host 127.0.0.1, port 3307, user roomq, database roomq
```

phpMyAdmin is available at `http://localhost:8081` (`PHPMYADMIN_HOST_PORT`).
MySQL and phpMyAdmin are published on `127.0.0.1` only, so they cannot be
reached from other machines; the RoomQ app itself (port 8080) can.

## Run locally without Docker

You need a reachable MySQL 8 server. Point the backend at it with the
`ROOMQ_DB_*` variables and start the server:

```powershell
$env:ROOMQ_DB_HOST = "127.0.0.1"
$env:ROOMQ_DB_PORT = "3306"
$env:ROOMQ_DB_USER = "roomq"
$env:ROOMQ_DB_PASSWORD = "your-db-password"
$env:ROOMQ_DB_NAME = "roomq"
$env:ROOMQ_ADMIN_PASSWORD = "choose-a-private-password"
npm install
npm start   # serves on http://localhost:3000 by default
```

The app creates the database (if the user has permission), tables, and the
initial administrator on first start, and adds any columns introduced since an
existing database was created. The server binds to `127.0.0.1`; set
`HOST`/`PORT` to change that.

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ROOMQ_DB_HOST` / `ROOMQ_DB_PORT` | MySQL host / port | `127.0.0.1` / `3306` |
| `ROOMQ_DB_USER` / `ROOMQ_DB_PASSWORD` | MySQL credentials | `roomq` / (empty) |
| `ROOMQ_DB_NAME` | Database name | `roomq` |
| `ROOMQ_ADMIN_EMAIL` / `ROOMQ_ADMIN_PASSWORD` | Initial admin (created once); sign in with email + password | `admin@roomq.local` / (required, ≥ 8 chars) |
| `ROOMQ_ADMIN_SIGNUP_KEY` | Enables `/api/register-admin` (≥ 16 chars) | disabled |
| `HOST` / `PORT` | Server bind address | `127.0.0.1` / `3000` |
| `ROOMQ_DB_POOL_SIZE` | Connection pool size | `10` |
| `ROOMQ_DB_CONNECT_ATTEMPTS` | Startup connection retries | `30` |
| `ROOMQ_TIMEZONE` | Campus time zone for reservation rules | system zone (`Asia/Manila` in Docker) |
| `ROOMQ_COOKIE_SECURE` | `auto` (Secure cookie only on HTTPS), `true`, or `false` | `auto` |
| `ROOMQ_TRUST_PROXY` | Trust `X-Forwarded-Proto`/`-For` from an HTTPS reverse proxy | `false` |
| `ROOMQ_RESERVATION_MAX_MINUTES` | Longest reservation a user can make | `240` |
| `ROOMQ_RESERVATION_HORIZON_DAYS` | How far ahead users can book | `90` |
| `ROOMQ_RESERVATION_MAX_ACTIVE` | Upcoming reservations a user can hold | `5` |

## API endpoints

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/api/health` | public | Liveness check. |
| GET | `/api/me` | public | Current session user (with `permissions`), if any. |
| GET / PUT | `/api/account` | session | Own details; edit name and email (role/status refused with 403). |
| POST | `/api/account/password` | session | Change own password (needs the current one). |
| GET | `/api/users` | `users.manage` | List accounts; filter with `q`, `role`, `status`. |
| POST | `/api/users` | `users.manage` | Create an account with a role. |
| GET / PUT / DELETE | `/api/users/:id` | `users.manage` | View, edit (profile, role, status, password), or delete an account. |
| PUT | `/api/classrooms/:id` | `classrooms.manage` | Record a classroom's capacity and facilities. |
| GET | `/api/performance` | `reports.view` | Measured response times against the two-second target. |
| POST | `/api/register` | public | Create a user account + session. |
| POST | `/api/register-admin` | setup key | Create an admin account + session. |
| POST | `/api/login` | public | Sign in (sets session cookie). |
| POST | `/api/logout` | session | Sign out. |
| GET | `/api/buildings` | public | Buildings and floors. |
| GET | `/api/classrooms` | public | Classrooms (filter by `buildingId`, `floorId`). |
| GET | `/api/availability` | public | Room status for a date/time range. |
| GET | `/api/dashboard` | public | Aggregate metrics. |
| GET | `/api/schedules` | public | List schedules/reservations (reservation owners shown to admins only). |
| GET | `/api/my/reservations` | session | The signed-in user's reservations. |
| POST | `/api/schedules` | session | Create (admin, staff: any; users: reservations only, see rules below). |
| PUT | `/api/schedules/:id` | `schedules.update` (admin, staff), or owner | Update a schedule; users may edit their own reservations. |
| DELETE | `/api/schedules/:id` | `schedules.delete` (admin), or owner | Delete a schedule; users may cancel their own reservations. |
| GET | `/api/conflicts` | `conflicts.view` (admin, staff) | Overlapping schedules. |
| GET | `/api/reports` | `reports.view` (admin) | Classrooms + schedules + conflicts snapshot. |
| GET | `/api/activity-logs` | `activity.view` (admin) | Paginated audit trail. |

## Authentication & authorization

Passwords are salted scrypt hashes. Sign-in issues a random session token; only
its SHA-256 hash is stored in `auth_sessions`, and the raw token is sent as an
`HttpOnly`, `SameSite=Strict` cookie. The cookie is marked `Secure` when the
request arrived over HTTPS (directly, or through a proxy when
`ROOMQ_TRUST_PROXY=true`), so sign-in also works over plain HTTP on the local
network.

### Roles and permissions

There are four roles, matching the user groups in the RoomQ study:
**Administrator** manages the system, **Staff** carry out scheduling work,
**Faculty** reserve rooms for academic activities, and **Student** views
classrooms, schedules and availability. Administrators and staff accounts are
created by an administrator; self-registration always creates a student, whom
an administrator can then promote. Permissions are defined once, in
`src/permissions.js`, and checked by the server on every request. `/api/me`
also sends a user's permission list to the browser, which uses it only to show
or hide controls; hiding a button never replaces the server check.

| Permission | Administrator | Staff | Faculty | Student |
|------------|:---:|:---:|:---:|:---:|
| Open the administrator portal (`/admin/*`) | yes | no | no | no |
| Open the staff portal (`/staff/*`) | via `/admin` | yes | no | no |
| View classrooms, schedules and availability | yes | yes | yes | yes |
| Add class schedules | yes | yes | no | no |
| Reserve a room | yes | yes | yes, with booking rules | no |
| Update schedules | yes | yes | own reservations only | no |
| Delete schedules | yes | no | own reservations only | no |
| View conflicts | yes | yes | no | no |
| View reports, response times and the activity log | yes | no | no | no |
| Edit classroom records (capacity, facilities) | yes | no | no | no |
| Manage users and roles (create, edit, deactivate, delete) | yes | no | no | no |
| Edit own name/email and change own password | yes | yes | no (no account page) | no |

Staff cannot change their own role or status (the request is refused with 403
even if forged), cannot create accounts, and cannot reach administrator pages
or APIs; pages redirect them to the staff dashboard and the API answers 403.
Signed-out requests get the sign-in page or 401. Role and status are read from
MySQL on every request, so a role change or deactivation applies immediately.

### Identity and data protection

Sign-up asks for a first and last name, a **school ID number**, a university
email address and a password. When `ROOMQ_ALLOWED_EMAIL_DOMAINS` is set,
self-registration is limited to those domains (subdomains included), so only
authorized university addresses can create an account. Administrators are the
authorizing party and may create an account with any address.

School ID numbers are personal data, so they are stored **AES-256-GCM
encrypted** (`src/crypto-box.js`) using `ROOMQ_ENCRYPTION_KEY`, alongside a
keyed blind index that keeps them unique and exactly searchable without storing
readable text. A school ID is shown only to the account's owner and to
administrators; it is never part of the session payload. Account holders cannot
edit their own school ID — only an administrator can correct it. Passwords are
*not* encrypted: they stay one-way salted scrypt hashes, which is what the
study's own review recommends for credentials.

The app refuses to start without a valid 32-byte `ROOMQ_ENCRYPTION_KEY`, rather
than quietly falling back to storing personal data unprotected.

### Classroom records

Administrators maintain each classroom's **seating capacity** and **facilities**
under **Classroom Records** (`/admin/rooms.html`). These are the values the
capacity and facility filters on the user portal search against, so recording
them is what makes "find a room that seats 40 with a projector" work. Buildings,
floors and the mapped positions come from the campus layout and are not editable
here. Every change is written to the activity log.

### Response times

The server times every API request and compares it with the project's
two-second target for core database operations. Requests over the target are
logged and counted. Administrators see the average, 95th percentile, slowest
response, the share within target and a per-operation breakdown under
**Reports → Response times** (`GET /api/performance`). Change the target with
`ROOMQ_RESPONSE_TARGET_MS`.

**Guarantees around accounts**
- At least one active administrator always exists: the last one cannot be
  demoted, deactivated or deleted, even by two administrators acting at once.
  You also cannot delete your own account, and your own role and status are
  locked in the user-management screen.
- Deactivating an account, or an administrator resetting its password, ends its
  open sessions. Changing your own password keeps only the current session.
- Passwords are 12 to 128 characters. User creation, role changes,
  (de)activation, password changes and deletion are written to the activity log
  (never with password data).

### Pages

- `/` sends guests to sign in, administrators to `/admin/dashboard.html`, staff
  to `/staff/dashboard.html` and users to `/user/dashboard.html`.
- Staff portal: `/staff/dashboard.html`, `schedules.html`, `conflicts.html`,
  `classrooms.html`, `account.html`. Schedules, conflicts and classrooms reuse
  the administrator page files (served under `/staff/`), so there is one copy of
  each; the API decides what each role may do inside them.
- Administrator portal: everything under `/admin/`, including **Users**
  (`/admin/users.html`) for account and role management.
- A new staff account is created in **Users → Add user** (or `POST /api/users`).

### Upgrading an existing database

Starting the app upgrades an older database in place. Earlier steps added
`staff`, the name/email/status columns and the indexes. The latest step adds the
`faculty` and `student` roles (accounts that used the old single `user` role
become students), the encrypted `school_id_cipher` / `school_id_index` columns,
and `classroom` as an activity-log entity type. Existing accounts keep their
roles and passwords and stay active; existing rooms keep their data.

Faculty accounts may reserve classrooms, and can view and cancel their own
reservations under **Classrooms → My reservations**. Those reservations must be
a single date, today or later (and not already started), within the booking
horizon, no longer than the maximum length, and one account can hold only a
limited number of upcoming reservations (see the `ROOMQ_RESERVATION_*`
variables). Students see the same classrooms, schedules and availability but
cannot book; the booking controls are hidden and the API answers 403.
Bookings for the same classroom are serialized with a row lock, so two
simultaneous requests cannot double-book a slot.

Failed sign-ins are limited per client address and email (10 per 15 minutes),
so one account being attacked does not lock out others. Successful account
creations are limited per client address (10 per 15 minutes).

## Tests

The suite runs against a live MySQL server, creating and dropping an isolated
`roomq_test_*` database per test, so the account must be able to CREATE/DROP
databases. With the Docker stack running, point the test variables at the
mapped MySQL port using an account with those privileges (e.g. `root`):

```powershell
$env:ROOMQ_DB_HOST = "127.0.0.1"
$env:ROOMQ_DB_PORT = "3307"          # MYSQL_HOST_PORT from .env
$env:ROOMQ_DB_USER = "root"
$env:ROOMQ_DB_PASSWORD = "your-root-password"   # MYSQL_ROOT_PASSWORD from .env
npm test
```

## Data notes

- The mapped buildings, floors, classroom positions, and names are shared from
  `public/shared/js/roomq-data.js`; no room positions are generated.
- Capacity/facility records are not yet supplied for all rooms; those values
  remain `null` until real records are added.
- Reservations created before reservation owners were recorded have no owner;
  only administrators can change those.
