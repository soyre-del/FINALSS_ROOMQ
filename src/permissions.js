// Role-based access control: one place that says what each role may do.
// The server checks these on every request; /api/me also sends the list to the
// browser, which uses it only to decide what to show (never to enforce).

const ROLES = Object.freeze(['admin', 'staff', 'user']);

const PERMISSIONS = Object.freeze({
  PORTAL_ADMIN: 'portal.admin', // open the administrator portal pages
  PORTAL_STAFF: 'portal.staff', // open the staff portal pages
  SCHEDULES_CREATE: 'schedules.create',
  SCHEDULES_UPDATE: 'schedules.update',
  SCHEDULES_DELETE: 'schedules.delete',
  CONFLICTS_VIEW: 'conflicts.view',
  REPORTS_VIEW: 'reports.view',
  ACTIVITY_VIEW: 'activity.view',
  USERS_MANAGE: 'users.manage' // list, create, edit, (de)activate, delete accounts; assign roles
});

const ROLE_PERMISSIONS = Object.freeze({
  // Administrators can do everything.
  admin: Object.freeze(Object.values(PERMISSIONS)),
  // Staff add and update schedules and review conflicts. They cannot delete
  // schedules, see reports or the audit trail, or manage accounts and roles.
  staff: Object.freeze([
    PERMISSIONS.PORTAL_STAFF,
    PERMISSIONS.SCHEDULES_CREATE,
    PERMISSIONS.SCHEDULES_UPDATE,
    PERMISSIONS.CONFLICTS_VIEW
  ]),
  // Self-registered users only reserve rooms (and manage their own reservations),
  // which is governed by reservation rules rather than by these permissions.
  user: Object.freeze([])
});

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function can(user, permission) {
  return Boolean(user) && permissionsFor(user.role).includes(permission);
}

module.exports = { PERMISSIONS, ROLES, ROLE_PERMISSIONS, can, permissionsFor };
