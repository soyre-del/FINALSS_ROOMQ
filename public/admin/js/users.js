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
    firstName: byId('userFirstName'),
    middleName: byId('userMiddleName'),
    lastName: byId('userLastName'),
    email: byId('userEmail'),
    role: byId('userRole'),
    password: byId('userPassword'),
    active: byId('userActive')
  };

  const ROLE_NAMES = { admin: 'Administrator', staff: 'Staff', user: 'User' };
  const nameOf = (account) => account.fullName || account.email;
  const ROLE_PILLS = {
    admin: 'status-pill-reserved',
    staff: 'status-pill-available',
    user: 'status-pill-occupied'
  };

  let allowed = false;
  let currentEmail = null;
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
      const isSelf = user.email === currentEmail;
      const row = document.createElement('tr');

      const account = document.createElement('td');
      const name = document.createElement('strong');
      name.textContent = nameOf(user) + (isSelf ? ' (you)' : '');
      account.append(name);
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
    const isSelf = Boolean(user && user.email === currentEmail);
    const label = user ? nameOf(user) : '';
    byId('userDialogHeading').textContent = user ? `Edit ${label}` : 'Add user';
    byId('userDialogKicker').textContent = user ? 'Account details' : 'New account';
    field.firstName.value = user && user.firstName ? user.firstName : '';
    field.middleName.value = user && user.middleName ? user.middleName : '';
    field.lastName.value = user && user.lastName ? user.lastName : '';
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
    field.firstName.focus();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  function validate(payload, isNew) {
    if (!payload.firstName) {
      return 'Enter a first name.';
    }
    if (!payload.lastName) {
      return 'Enter a last name.';
    }
    if ((isNew || payload.password) && (payload.password.length < 12 || payload.password.length > 128)) {
      return 'Password must be between 12 and 128 characters.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return 'Enter a valid email address.';
    }
    return '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      firstName: field.firstName.value.trim(),
      middleName: field.middleName.value.trim(),
      lastName: field.lastName.value.trim(),
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
          firstName: payload.firstName,
          middleName: payload.middleName || null,
          lastName: payload.lastName,
          email: payload.email,
          password: payload.password,
          role: payload.role,
          isActive: payload.isActive
        })
      });
    } else {
      const changes = {};
      if (payload.firstName !== (editing.firstName || '')) changes.firstName = payload.firstName;
      if (payload.middleName !== (editing.middleName || '')) changes.middleName = payload.middleName;
      if (payload.lastName !== (editing.lastName || '')) changes.lastName = payload.lastName;
      if (payload.email !== (editing.email || '')) changes.email = payload.email;
      if (payload.role !== editing.role) changes.role = payload.role;
      if (payload.isActive !== editing.isActive) changes.isActive = payload.isActive;
      if (payload.password) changes.password = payload.password;
      if (!Object.keys(changes).length) {
        say(dialogFeedback, 'Nothing was changed.', true);
        return;
      }
      if (changes.role && !window.confirm(
        `Change ${nameOf(editing)} from ${ROLE_NAMES[editing.role]} to ${ROLE_NAMES[changes.role]}? Their access changes immediately.`
      )) return;
      if (changes.isActive === false && !window.confirm(
        `Deactivate ${nameOf(editing)}? They will be signed out and unable to sign in.`
      )) return;
      if (changes.password && !window.confirm(
        `Reset the password for ${nameOf(editing)}? They will be signed out everywhere.`
      )) return;
      request = api.request(`/api/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(changes) });
    }

    saveButton.disabled = true;
    say(dialogFeedback, 'Saving…');
    try {
      const saved = await request;
      closeDialog();
      say(feedback, editing ? `Saved changes to ${nameOf(saved)}.` : `Created ${nameOf(saved)}.`);
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
      ? `Activate ${nameOf(user)}? They will be able to sign in again.`
      : `Deactivate ${nameOf(user)}? They will be signed out and unable to sign in.`;
    if (!window.confirm(question)) return;
    try {
      await api.request(`/api/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: activating })
      });
      say(feedback, `${nameOf(user)} was ${activating ? 'activated' : 'deactivated'}.`);
      await loadUsers();
    } catch (error) {
      say(feedback, error.message, true);
    }
  }

  async function removeUser(user) {
    if (!window.confirm(
      `Permanently delete ${nameOf(user)}? This cannot be undone. Their past activity stays in the audit log.`
    )) return;
    try {
      await api.request(`/api/users/${user.id}`, { method: 'DELETE' });
      say(feedback, `${nameOf(user)} was deleted.`);
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
    currentEmail = user ? user.email : null;
    addButton.disabled = !allowed;
    loadUsers();
  });
});
