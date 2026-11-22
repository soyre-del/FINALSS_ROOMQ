# RoomQ

RoomQ is a Node.js-served classroom scheduling and availability application. Its room inventory and plan coordinates come from the existing mapped layouts in `public/roomq-data.js`; schedule and reservation records are stored in SQLite.

## Project layout

- `src/` contains the Node.js server, SQLite access, and schedule rules.
- `public/` contains the HTML, CSS, browser scripts, and image assets.
- `tests/` contains the Node.js test suite.
- `roomq.sqlite` is the local runtime database and remains in the project root.

## Requirements

- Node.js 24 or later

## Run locally

Set a private administrator password of at least 12 characters, then start the server:

```powershell
$env:ROOMQ_ADMIN_PASSWORD = "choose-a-private-password"
npm start
```

Open `http://localhost:3000`. The shared sign-in page accepts either an administrator or user account and routes each to the appropriate page. New accounts created there are user accounts and can reserve classrooms; schedule management remains administrator-only. The default administrator username is `admin`; set `ROOMQ_ADMIN_USERNAME` to change it. The SQLite database is created as `roomq.sqlite` and is intentionally excluded from source control.

## Additional administrator accounts

Admin self-sign-up is protected by a private setup key. Configure it before starting the server:

```powershell
$env:ROOMQ_ADMIN_SIGNUP_KEY = "replace-with-a-private-key-of-at-least-16-characters"
npm start
```

Keep the key private and do not commit it. Additional administrator accounts can be created through the protected `/api/register-admin` endpoint using the setup key. The initial administrator is provisioned with `ROOMQ_ADMIN_USERNAME` and `ROOMQ_ADMIN_PASSWORD` when the database is first created.

The server binds to `127.0.0.1` by default. Set `HOST` and `PORT` explicitly only when deploying behind an HTTPS reverse proxy or when access from another machine is required. Set `ROOMQ_DB_PATH` to store the SQLite database at a custom path. Set `NODE_ENV=production` to enable the secure session-cookie attribute.

## Tests

```powershell
npm test
```

## Data notes

- The mapped buildings, floors, classroom positions, and names are shared from `public/roomq-data.js`; no room positions are generated.
- The project has no capacity/facility records or classroom mapping for LAW Rooms. Those values remain unavailable until real records are supplied.
- Passwords are stored as salted scrypt hashes. Users can create reservations; creating or editing class schedules and managing conflicts requires an administrator session.
- Browser-local room-use data from earlier versions is not automatically uploaded to the database.
