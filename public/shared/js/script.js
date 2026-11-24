document.addEventListener('DOMContentLoaded', () => {
  // Format today's date
  const dateEl = document.getElementById('todayDate');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Mobile menu toggle support
  const toggle = document.getElementById('menuToggle');
  const shell = document.querySelector('.app-shell');
  if (toggle && shell) {
    toggle.addEventListener('click', () => {
      shell.classList.toggle('sidebar-open');
    });
  }

  // Check URL parameters for access alerts
  const urlParams = new URLSearchParams(window.location.search);
  const deniedArea = urlParams.get('denied');
  if (deniedArea === 'admin' || deniedArea === 'staff') {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-warning alert-dismissible fade show m-3';
    alertDiv.setAttribute('role', 'alert');
    const message = deniedArea === 'admin'
      ? 'Administrator privileges are required to access management functions.'
      : 'A staff or administrator account is required to open that page.';
    alertDiv.innerHTML = `
      <strong>Access Restricted:</strong> <span></span>
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    alertDiv.querySelector('span').textContent = message;
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.prepend(alertDiv);
    }
  }

  // Session & role-based sidebar management
  syncSessionAndNavigation();
});

async function syncSessionAndNavigation() {
  let currentUser = null;
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.ok) {
      const data = await response.json();
      if (data && data.authenticated && data.user) {
        currentUser = data.user;
      }
    }
  } catch {
    // Keep currentUser as null on fetch errors
  }

  const isAdminPage = window.location.pathname.includes('/admin/');
  const isStaffPage = window.location.pathname.includes('/staff/');
  const isUserPage = window.location.pathname.includes('/user/');
  const hasPermission = (permission) =>
    Boolean(currentUser && Array.isArray(currentUser.permissions) &&
      currentUser.permissions.includes(permission));
  const roleLabel = (role) => ({ admin: 'Administrator', staff: 'Staff' }[role] || 'Student / User');
  const displayName = (user) => user.fullName || user.email;

  // Access control guard (the server enforces the same rule; this covers pages
  // restored from the browser's back/forward cache after signing out).
  if ((isAdminPage || isStaffPage) && !currentUser) {
    const back = window.location.pathname + window.location.search;
    window.location.replace(`/user/login.html?returnTo=${encodeURIComponent(back)}`);
    return;
  }
  if (isAdminPage && !hasPermission('portal.admin')) {
    window.location.replace(currentUser.role === 'staff'
      ? '/staff/dashboard.html?denied=admin'
      : '/user/dashboard.html?denied=admin');
    return;
  }
  if (isStaffPage && !hasPermission('portal.staff')) {
    window.location.replace('/user/dashboard.html?denied=staff');
    return;
  }

  // Staff share the admin page layouts. Show them their own portal name and
  // drop links to modules their role cannot open (the server refuses those
  // requests regardless).
  if (currentUser && (isAdminPage || isStaffPage)) {
    const portalName = currentUser.role === 'staff' ? 'Staff Portal' : 'Admin Portal';
    document.querySelectorAll('.brand-sub-badge, .workspace-breadcrumb a:first-child').forEach((element) => {
      if (element.textContent.trim() === 'Admin Portal') element.textContent = portalName;
    });
    const modulePermissions = {
      'insights.html': 'portal.admin',
      'assignments.html': 'portal.admin',
      'conflicts.html': 'conflicts.view',
      'reports.html': 'reports.view',
      'activity-logs.html': 'activity.view',
      'users.html': 'users.manage'
    };
    document.querySelectorAll(
      '.sidebar-nav a.nav-item, .dropdown-menu a.dropdown-item, .workspace-footer-links a'
    ).forEach((link) => {
      const target = (link.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop();
      if (modulePermissions[target] && !hasPermission(modulePermissions[target])) {
        link.remove();
      }
    });
    if (currentUser.role === 'staff') {
      document.querySelectorAll('.dropdown-menu a.dropdown-item').forEach((link) => {
        if (link.lastChild && link.lastChild.textContent.trim() === 'Admin Dashboard') {
          link.lastChild.textContent = 'Dashboard';
        }
      });
    }
    document.querySelectorAll('.sidebar-nav .nav-group').forEach((group) => {
      if (!group.querySelector('a.nav-item')) group.remove();
    });
    // Every management account can reach its own account page from the profile menu.
    const profileMenu = document.querySelector('.workspace-profile-trigger + .dropdown-menu');
    if (profileMenu && !profileMenu.querySelector('[data-account-link]')) {
      const accountLink = document.createElement('a');
      accountLink.className = 'dropdown-item';
      accountLink.href = '/staff/account.html';
      accountLink.dataset.accountLink = 'true';
      accountLink.innerHTML = '<i class="bi bi-person-gear me-2"></i>My account';
      profileMenu.prepend(accountLink);
    }
  }

  // Update profile boxes in sidebar
  const profileBoxes = document.querySelectorAll('.profile-box, #sidebarProfileBox');
  profileBoxes.forEach((box) => {
    const avatar = box.querySelector('#sidebarMiniAvatar, .mini-avatar');
    const nameEl = box.querySelector('#sidebarProfileName, strong');
    const roleEl = box.querySelector('#sidebarProfileRole, span:not(.mini-avatar)');

    if (currentUser) {
      const initials = (displayName(currentUser) || 'U').slice(0, 2).toUpperCase();
      if (avatar) avatar.textContent = initials;
      if (nameEl) nameEl.textContent = displayName(currentUser);
      if (roleEl) {
        roleEl.textContent = roleLabel(currentUser.role);
      }
    } else {
      if (avatar) avatar.textContent = isAdminPage ? 'AD' : 'GU';
      if (nameEl) nameEl.textContent = isAdminPage ? 'Administrator' : 'Guest User';
      if (roleEl) roleEl.textContent = isAdminPage ? 'Admin Portal' : 'Viewing Spaces';
    }
  });

  // Update topbar user pills if present
  const topbarUserPills = document.querySelectorAll('.user-pill, #topbarUserPill');
  topbarUserPills.forEach((pill) => {
    const avatar = pill.querySelector('#topbarAvatar, .user-avatar');
    const nameEl = pill.querySelector('#topbarUsername, strong');
    const roleEl = pill.querySelector('#topbarRole, .workspace-profile-meta span');
    if (currentUser) {
      if (avatar) avatar.textContent = (displayName(currentUser) || 'U').slice(0, 2).toUpperCase();
      if (nameEl) nameEl.textContent = displayName(currentUser);
      if (roleEl) roleEl.textContent = roleLabel(currentUser.role);
    } else {
      if (avatar) avatar.textContent = isAdminPage ? 'AD' : 'GU';
      if (nameEl) nameEl.textContent = isAdminPage ? 'Admin' : 'Guest';
      if (roleEl) roleEl.textContent = isAdminPage ? 'Not signed in' : 'Viewing Spaces';
    }
  });

  const currentPath = window.location.pathname + window.location.search + window.location.hash;
  const loginBase = isUserPage ? 'login.html' : '../user/login.html';
  const loginUrl = `${loginBase}?returnTo=${encodeURIComponent(currentPath)}`;

  async function performSignOut(event) {
    if (event) event.preventDefault();
    try {
      await fetch('/api/logout', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
      });
    } catch {
      // ignore network error and redirect to login
    }
    window.location.assign('/user/login.html');
  }

  // Ensure Header Sign In & Sign Out Buttons exist on every workspace header
  const headerRight = document.querySelector('.workspace-header-right');
  if (headerRight && !document.getElementById('headerAuthActions')) {
    const authWrap = document.createElement('div');
    authWrap.className = 'header-auth-actions';
    authWrap.id = 'headerAuthActions';
    authWrap.innerHTML = `
      <a href="${loginUrl}" class="btn-header-auth btn-header-login" id="headerLoginBtn" title="Sign in to RoomQ">
        <i class="bi bi-box-arrow-in-right"></i>
        <span>Sign In</span>
      </a>
      <button type="button" class="btn-header-auth btn-header-logout" id="headerLogoutBtn" title="Sign out of RoomQ" hidden>
        <i class="bi bi-box-arrow-right"></i>
        <span>Sign Out</span>
      </button>
    `;
    headerRight.append(authWrap);
  }

  const headerLoginBtn = document.getElementById('headerLoginBtn');
  if (headerLoginBtn) {
    headerLoginBtn.href = loginUrl;
    headerLoginBtn.hidden = Boolean(currentUser);
  }

  const headerLogoutBtn = document.getElementById('headerLogoutBtn');
  if (headerLogoutBtn) {
    headerLogoutBtn.hidden = !currentUser;
    headerLogoutBtn.addEventListener('click', performSignOut);
  }

  const headerAuthActions = document.getElementById('headerAuthActions');
  if (headerAuthActions) {
    headerAuthActions.hidden = false;
  }

  // Remove any redundant header dropdown login/account link if present
  const headerAccountAction = document.getElementById('headerAccountAction');
  if (headerAccountAction) {
    const prevDivider = headerAccountAction.previousElementSibling;
    if (prevDivider && prevDivider.classList.contains('dropdown-divider')) {
      prevDivider.remove();
    }
    headerAccountAction.remove();
  }

  const headerPortalSwitch = document.getElementById('headerPortalSwitch');
  if (headerPortalSwitch) {
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff')) {
      const ownPortal = currentUser.role === 'admin' ? 'admin' : 'staff';
      headerPortalSwitch.hidden = false;
      if (isAdminPage || isStaffPage) {
        headerPortalSwitch.innerHTML = '<i class="bi bi-eye me-2"></i>Switch to User Portal';
        headerPortalSwitch.href = '/user/dashboard.html';
      } else {
        headerPortalSwitch.innerHTML = `<i class="bi bi-shield-lock me-2"></i>${ownPortal === 'admin' ? 'Admin' : 'Staff'} Portal`;
        headerPortalSwitch.href = `/${ownPortal}/dashboard.html`;
      }
    } else {
      headerPortalSwitch.hidden = true;
    }
  }

  // Global search bar Enter navigation fallback
  const globalSearch = document.getElementById('globalWorkspaceSearch');
  if (globalSearch) {
    globalSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && globalSearch.value.trim()) {
        if (!window.location.pathname.endsWith('dashboard.html') &&
            !window.location.pathname.endsWith('insights.html') &&
            !window.location.pathname.endsWith('buildings.html') &&
            !window.location.pathname.endsWith('classrooms.html')) {
          e.preventDefault();
          window.location.assign(`classrooms.html?q=${encodeURIComponent(globalSearch.value.trim())}`);
        }
      }
    });
  }

  // User-specific elements:
  const adminPortalNavGroup = document.getElementById('adminPortalNavGroup');
  if (adminPortalNavGroup) {
    const managesPortal = Boolean(currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff'));
    adminPortalNavGroup.hidden = !managesPortal;
    if (managesPortal && currentUser.role === 'staff') {
      const label = adminPortalNavGroup.querySelector('.nav-section-label');
      const link = adminPortalNavGroup.querySelector('a.nav-item');
      if (label) label.textContent = 'Staff Portal';
      if (link) {
        link.href = '/staff/dashboard.html';
        link.lastChild.textContent = 'Staff Dashboard';
      }
    }
  }

  const viewFullScheduleLink = document.getElementById('viewFullScheduleLink');
  if (viewFullScheduleLink) {
    viewFullScheduleLink.hidden = !(currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff'));
    if (currentUser && currentUser.role === 'staff') {
      viewFullScheduleLink.href = '/staff/schedules.html';
    }
  }
}
