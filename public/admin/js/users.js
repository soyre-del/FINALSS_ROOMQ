// User management (administrators). Every action goes through /api/users, which
// the server restricts to accounts holding the users.manage permission.
document.addEventListener('DOMContentLoaded', () => {
  const api = window.RoomQApi;
  const byId = (id) => document.getElementById(id);
  const tableBody = byId('userTableBody');
  const emptyState = byId('userEmpty');
  const feedback = byId('userFeedback');
  const filterForm = byId('userFilterForm');
  const searchInput = byId('userSearch');
  const roleFilter = byId('userRoleFilter');
  const statusFilter = byId('userStatusFilter');
  const addButton = byId('userAddButton');
  const dialog = byId('userDialog');
  const form = byId('userForm');
  const dialogFeedback = byId('userDialogFeedback');
  const saveButton = byId('userSave');
  const field = {
    username: byId('userUsername'),
    fullName: byId('userFullName'),
    email: byId('userEmail'),
    role: byId('userRole'),
    password: byId('userPassword'),
    active: byId('userActive')
  };

  const ROLE_NAMES = { admin: 'Administrator', staff: 'Staff', user: 'User' };
  const ROLE_PILLS = {
    admin: 'status-pill-reserved',
    staff: 'status-pill-available',
    user: 'status-pill-occupied'
  };

  let allowed = false;
  let currentUsername = null;
  let users = [];
  let editing = null; // the account being edited, or null when creating

  function say(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('is-error', isError);
  }

  function pill(text, modifier) {
    const element = document.createElement('span');
    element.className = `status-pill ${modifier}`;
    element.textContent = text;
    return element;
  }

  function formatDate(value) {
    const date = new Date(`${String(value).replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date);
  }

  function renderStats(everyone) {
    byId('userStatTotal').textContent = String(everyone.length);
    byId('userStatAdmins').textContent = String(everyone.filter((u) => u.role === 'admin').length);
    byId('userStatStaff').textContent = String(everyone.filter((u) => u.role === 'staff').length);
    byId('userStatInactive').textContent = String(everyone.filter((u) => !u.isActive).length);
  }

  function actionButton(label, className, handler, disabledReason) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `table-action-button${className ? ` ${className}` : ''}`;
    button.textContent = label;
    if (disabledReason) {
      button.disabled = true;
      button.title = disabledReason;
    }
    button.addEventListener('click', handler);
    return button;
  }

  function render() {
    tableBody.replaceChildren();
    users.forEach((user) => {
      const isSelf = user.username === currentUsername;
      const row = document.createElement('tr');

      const account = document.createElement('td');
      const name = document.createElement('strong');
      name.textContent = user.username + (isSelf ? ' (you)' : '');
      account.append(name);
      if (user.fullName) {
        const full = document.createElement('div');
        full.className = 'text-muted small';
        full.textContent = user.fullName;
        account.append(full);
      }
      row.append(account);

      const email = document.createElement('td');
      email.textContent = user.email || '—';
      row.append(email);

      const role = document.createElement('td');
      role.append(pill(ROLE_NAMES[user.role] || user.role, ROLE_PILLS[user.role] || 'status-pill-occupied'));
      row.append(role);

      const status = document.createElement('td');
      status.append(user.isActive
        ? pill('Active', 'status-pill-available')
        : pill('Deactivated', 'status-pill-danger'));
      row.append(status);

      const created = document.createElement('td');
      created.textContent = formatDate(user.createdAt);
      row.append(created);

      const actions = document.createElement('td');
      actions.append(
        actionButton('Edit', '', () => openDialog(user)),
        actionButton(
          user.isActive ? 'Deactivate' : 'Activate',
          user.isActive ? 'is-danger' : '',
          () => toggleActive(user),
          isSelf ? 'You cannot deactivate your own account.' : ''
        ),
        actionButton(
          'Delete',
          'is-danger',
          () => removeUser(user),
          isSelf ? 'You cannot delete your own account.' : ''
        )
      );
      row.append(actions);
      tableBody.append(row);
    });
    emptyState.hidden = users.length > 0;
    emptyState.textContent = allowed
      ? 'No accounts match the selected filters.'
      : 'Sign in as an administrator to manage users.';
  }

  async function loadUsers() {
    if (!allowed) {
      users = [];
      render();
      return;
    }
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (roleFilter.value) params.set('role', roleFilter.value);
    if (statusFilter.value) params.set('status', statusFilter.value);
    try {
      const filtered = params.toString() !== '';
      users = await api.request(`/api/users${filtered ? `?${params}` : ''}`);
      renderStats(filtered ? await api.request('/api/users') : users);
      // Keep a success message from the action that triggered this reload, but
      // clear a stale "could not be loaded" error.
      if (feedback.classList.contains('is-error')) say(feedback, '');
      render();
    } catch (error) {
      say(feedback, `Accounts could not be loaded: ${error.message}`, true);
    }
  }

  function openDialog(user) {
    editing = user || null;
    const isSelf = Boolean(user && user.username === currentUsername);
    byId('userDialogHeading').textContent = user ? `Edit ${user.username}` : 'Add user';
    byId('userDialogKicker').textContent = user ? 'Account details' : 'New account';
    field.username.value = user ? user.username : '';
    field.username.readOnly = Boolean(user);
    field.fullName.value = user && user.fullName ? user.fullName : '';
    field.email.value = user && user.email ? user.email : '';
    field.role.value = user ? user.role : 'staff';
    field.active.value = user ? String(user.isActive) : 'true';
    // Your own role and status are changed by another administrator, so you
    // cannot lock yourself out by accident.
    field.role.disabled = isSelf;
    field.active.disabled = isSelf;
    field.password.value = '';
    field.password.required = !user;
    byId('userPasswordLabel').textContent = user
      ? 'New password (leave blank to keep the current one)'
      : 'Password (12 to 128 characters)';
    say(dialogFeedback, isSelf ? 'You are editing your own account, so role and status are locked.' : '');
    dialog.showModal();
    (user ? field.fullName : field.username).focus();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  function validate(payload, isNew) {
    if (isNew && !/^[A-Za-z0-9._-]{3,32}$/.test(payload.username)) {
      return 'Username must be 3-32 characters using letters, numbers, dots, underscores, or hyphens.';
    }
    if ((isNew || payload.password) && (payload.password.length < 12 || payload.password.length > 128)) {
      return 'Password must be between 12 and 128 characters.';
    }
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return 'Enter a valid email address.';
    }
    return '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      username: field.username.value.trim(),
      fullName: field.fullName.value.trim(),
      email: field.email.value.trim(),
      role: field.role.value,
      password: field.password.value,
      isActive: field.active.value === 'true'
    };
    const problem = validate(payload, !editing);
    if (problem) {
      say(dialogFeedback, problem, true);
      return;
    }

    let request;
    if (!editing) {
      if (payload.role === 'admin' &&
          !window.confirm('Create an administrator account? Administrators have full control of RoomQ.')) {
        return;
      }
      request = api.request('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: payload.username,
          password: payload.password,
          fullName: payload.fullName,
          email: payload.email,
          role: payload.role,
          isActive: payload.isActive
        })
      });
    } else {
      const changes = {};
      if (payload.fullName !== (editing.fullName || '')) changes.fullName = payload.fullName;
      if (payload.email !== (editing.email || '')) changes.email = payload.email;
      if (payload.role !== editing.role) changes.role = payload.role;
      if (payload.isActive !== editing.isActive) changes.isActive = payload.isActive;
      if (payload.password) changes.password = payload.password;
      if (!Object.keys(changes).length) {
        say(dialogFeedback, 'Nothing was changed.', true);
        return;
      }
      if (changes.role && !window.confirm(
        `Change ${editing.username} from ${ROLE_NAMES[editing.role]} to ${ROLE_NAMES[changes.role]}? Their access changes immediately.`
      )) return;
      if (changes.isActive === false && !window.confirm(
        `Deactivate ${editing.username}? They will be signed out and unable to sign in.`
      )) return;
      if (changes.password && !window.confirm(
        `Reset the password for ${editing.username}? They will be signed out everywhere.`
      )) return;
      request = api.request(`/api/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(changes) });
    }

    saveButton.disabled = true;
    say(dialogFeedback, 'Saving…');
    try {
      const saved = await request;
      closeDialog();
      say(feedback, editing ? `Saved changes to ${saved.username}.` : `Created ${saved.username}.`);
      await loadUsers();
    } catch (error) {
      say(dialogFeedback, error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  });

  async function toggleActive(user) {
    const activating = !user.isActive;
    const question = activating
      ? `Activate ${user.username}? They will be able to sign in again.`
      : `Deactivate ${user.username}? They will be signed out and unable to sign in.`;
    if (!window.confirm(question)) return;
    try {
      await api.request(`/api/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: activating })
      });
      say(feedback, `${user.username} was ${activating ? 'activated' : 'deactivated'}.`);
      await loadUsers();
    } catch (error) {
      say(feedback, error.message, true);
    }
  }

  async function removeUser(user) {
    if (!window.confirm(
      `Permanently delete ${user.username}? This cannot be undone. Their past activity stays in the audit log.`
    )) return;
    try {
      await api.request(`/api/users/${user.id}`, { method: 'DELETE' });
      say(feedback, `${user.username} was deleted.`);
      await loadUsers();
    } catch (error) {
      say(feedback, error.message, true);
    }
  }

  addButton.addEventListener('click', () => openDialog(null));
  byId('userDialogClose').addEventListener('click', closeDialog);
  byId('userDialogCancel').addEventListener('click', closeDialog);
  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    loadUsers();
  });
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadUsers, 300);
  });
  [roleFilter, statusFilter].forEach((select) => select.addEventListener('change', loadUsers));

  api.mountAdminPanel(byId('adminSessionPanel'), (user) => {
    allowed = api.can(user, 'users.manage');
    currentUsername = user ? user.username : null;
    addButton.disabled = !allowed;
    loadUsers();
  });
});
