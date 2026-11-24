// "My account": view own details, edit name/email, change password. Role and
// status are shown but never sent; the server rejects them even if forced.
document.addEventListener('DOMContentLoaded', () => {
  const api = window.RoomQApi;
  const summary = document.getElementById('accountSummary');
  const form = document.getElementById('accountForm');
  const firstName = document.getElementById('accountFirstName');
  const middleName = document.getElementById('accountMiddleName');
  const lastName = document.getElementById('accountLastName');
  const email = document.getElementById('accountEmail');
  const feedback = document.getElementById('accountFeedback');
  const save = document.getElementById('accountSave');
  const passwordForm = document.getElementById('passwordForm');
  const passwordFeedback = document.getElementById('passwordFeedback');
  const passwordSave = document.getElementById('passwordSave');
  const defaultPasswordNote = passwordFeedback.textContent;

  const roleName = { admin: 'Administrator', staff: 'Staff', user: 'User' };

  function showFeedback(element, message, isError) {
    element.textContent = message;
    element.classList.toggle('is-error', Boolean(isError));
  }

  function renderSummary(account) {
    summary.replaceChildren();
    const memberSince = new Date(`${account.createdAt.replace(' ', 'T')}Z`);
    [
      ['Account', account.email],
      ['Full Name', account.fullName || '—'],
      ['Role', roleName[account.role] || account.role],
      ['Status', account.isActive ? 'Active' : 'Deactivated'],
      ['Member since', Number.isNaN(memberSince.getTime())
        ? account.createdAt
        : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(memberSince)]
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      summary.append(row);
    });
  }

  function fill(account) {
    renderSummary(account);
    if (firstName) firstName.value = account.firstName || '';
    if (middleName) middleName.value = account.middleName || '';
    if (lastName) lastName.value = account.lastName || '';
    email.value = account.email || '';
  }

  api.request('/api/account')
    .then(fill)
    .catch((error) => showFeedback(feedback, `Your account could not be loaded: ${error.message}`, true));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    showFeedback(feedback, 'Saving…', false);
    try {
      fill(await api.request('/api/account', {
        method: 'PUT',
        body: JSON.stringify({
          firstName: firstName ? firstName.value : undefined,
          middleName: middleName ? middleName.value : undefined,
          lastName: lastName ? lastName.value : undefined,
          email: email.value
        })
      }));
      showFeedback(feedback, 'Your details were saved.', false);
    } catch (error) {
      showFeedback(feedback, error.message, true);
    } finally {
      save.disabled = false;
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = document.getElementById('currentPassword');
    const next = document.getElementById('newPassword');
    const confirm = document.getElementById('confirmPassword');
    if (next.value.length < 12 || next.value.length > 128) {
      showFeedback(passwordFeedback, 'The new password must be between 12 and 128 characters.', true);
      next.focus();
      return;
    }
    if (next.value !== confirm.value) {
      showFeedback(passwordFeedback, 'The new passwords do not match.', true);
      confirm.focus();
      return;
    }
    passwordSave.disabled = true;
    showFeedback(passwordFeedback, 'Changing password…', false);
    try {
      await api.request('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current.value, newPassword: next.value })
      });
      passwordForm.reset();
      showFeedback(passwordFeedback, `Password changed. ${defaultPasswordNote}`, false);
    } catch (error) {
      showFeedback(passwordFeedback, error.message, true);
    } finally {
      passwordSave.disabled = false;
    }
  });
});
