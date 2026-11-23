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
  if (urlParams.get('denied') === 'admin') {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-warning alert-dismissible fade show m-3';
    alertDiv.setAttribute('role', 'alert');
    alertDiv.innerHTML = `
      <strong>Access Restricted:</strong> Administrator privileges are required to access management functions.
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
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
  const isUserPage = window.location.pathname.includes('/user/');

  // Access control guard: Non-admin users cannot access admin pages
  if (isAdminPage && currentUser && currentUser.role !== 'admin') {
    window.location.replace('/user/dashboard.html?denied=admin');
    return;
  }

  // Update profile boxes in sidebar
  const profileBoxes = document.querySelectorAll('.profile-box, #sidebarProfileBox');
  profileBoxes.forEach((box) => {
    const avatar = box.querySelector('#sidebarMiniAvatar, .mini-avatar');
    const nameEl = box.querySelector('#sidebarProfileName, strong');
    const roleEl = box.querySelector('#sidebarProfileRole, span:not(.mini-avatar)');

    if (currentUser) {
      const initials = (currentUser.username || 'U').slice(0, 2).toUpperCase();
      if (avatar) avatar.textContent = initials;
      if (nameEl) nameEl.textContent = currentUser.username;
      if (roleEl) {
        roleEl.textContent = currentUser.role === 'admin' ? 'Administrator' : 'Student / User';
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
      if (avatar) avatar.textContent = (currentUser.username || 'U').slice(0, 2).toUpperCase();
      if (nameEl) nameEl.textContent = currentUser.username;
      if (roleEl) roleEl.textContent = currentUser.role === 'admin' ? 'Administrator' : 'Student / User';
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
    if (currentUser && currentUser.role === 'admin') {
      headerPortalSwitch.hidden = false;
      if (isAdminPage) {
        headerPortalSwitch.innerHTML = '<i class="bi bi-eye me-2"></i>Switch to User Portal';
        headerPortalSwitch.href = '../user/dashboard.html';
      } else {
        headerPortalSwitch.innerHTML = '<i class="bi bi-shield-lock me-2"></i>Admin Portal';
        headerPortalSwitch.href = '../admin/dashboard.html';
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
    adminPortalNavGroup.hidden = !(currentUser && currentUser.role === 'admin');
  }

  const viewFullScheduleLink = document.getElementById('viewFullScheduleLink');
  if (viewFullScheduleLink) {
    viewFullScheduleLink.hidden = !(currentUser && currentUser.role === 'admin');
  }
}
