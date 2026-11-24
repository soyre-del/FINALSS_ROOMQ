// Role-based access control: one place that says what each role may do.
// The server checks these on every request; /api/me also sends the list to the
// browser, which uses it only to decide what to show (never to enforce).
//
// The four roles mirror the user groups in the RoomQ study: administrators
// manage the system, staff carry out scheduling work, faculty reserve rooms for
// academic activities, and students view classrooms, schedules and availability.

const ROLES = Object.freeze(['admin', 'staff', 'faculty', 'student']);

const ROLE_LABELS = Object.freeze({
  admin: 'Administrator',
  staff: 'Staff',
  faculty: 'Faculty',
  student: 'Student'
});

const PERMISSIONS = Object.freeze({
  PORTAL_ADMIN: 'portal.admin', // open the administrator portal pages
  PORTAL_STAFF: 'portal.staff', // open the staff portal pages
  SCHEDULES_CREATE: 'schedules.create',
  SCHEDULES_UPDATE: 'schedules.update',
  SCHEDULES_DELETE: 'schedules.delete',
  RESERVATIONS_CREATE: 'reservations.create', // reserve a room for an activity
  CLASSROOMS_MANAGE: 'classrooms.manage', // edit classroom records (capacity, facilities)
  CONFLICTS_VIEW: 'conflicts.view',
  REPORTS_VIEW: 'reports.view',
  ACTIVITY_VIEW: 'activity.view',
  USERS_MANAGE: 'users.manage' // list, create, edit, (de)activate, delete accounts; assign roles
});

const ROLE_PERMISSIONS = Object.freeze({
  // Administrators can do everything.
  admin: Object.freeze(Object.values(PERMISSIONS)),
  // Staff add and update schedules, reserve rooms and review conflicts. They
  // cannot delete schedules, edit classroom records, see reports or the audit
  // trail, or manage accounts and roles.
  staff: Object.freeze([
    PERMISSIONS.PORTAL_STAFF,
    PERMISSIONS.SCHEDULES_CREATE,
    PERMISSIONS.SCHEDULES_UPDATE,
    PERMISSIONS.RESERVATIONS_CREATE,
    PERMISSIONS.CONFLICTS_VIEW
  ]),
  // Faculty check availability and reserve rooms for academic activities. The
  // reservation rules (future dates, length, how many at once) still apply.
  faculty: Object.freeze([
    PERMISSIONS.RESERVATIONS_CREATE
  ]),
  // Students view classrooms, schedules and availability. They do not book.
  student: Object.freeze([])
});

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function can(user, permission) {
  return Boolean(user) && permissionsFor(user.role).includes(permission);
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

module.exports = { PERMISSIONS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS, can, permissionsFor, roleLabel };
