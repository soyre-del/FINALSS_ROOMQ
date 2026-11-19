(function () {
  const form = document.getElementById('authForm');
  const username = document.getElementById('authUsername');
  const password = document.getElementById('authPassword');
  const confirmPasswordField = document.getElementById('confirmPasswordField');
  const confirmPassword = document.getElementById('authPasswordConfirm');
  const adminSetupKeyField = document.getElementById('adminSetupKeyField');
  const adminSetupKey = document.getElementById('adminSetupKey');
  const feedback = document.getElementById('authFeedback');
  const submit = document.getElementById('authSubmit');
  const heading = document.getElementById('authHeading');
  const description = document.getElementById('authDescription');
  const modeToggle = document.getElementById('authModeToggle');
  const securityNote = document.getElementById('authSecurityNote');
  const roleButtons = [...document.querySelectorAll('[data-auth-role]')];
  const query = new URLSearchParams(window.location.search);
  let role = 'user';
  let mode = 'login';

  function getSafeReturnPath() {
    const requested = query.get('returnTo');
    if (!requested) {
      return null;
    }
    try {
      const target = new URL(requested, window.location.origin);
      return target.origin === window.location.origin && target.pathname === '/classrooms.html'
        ? `${target.pathname}${target.search}${target.hash}`
        : null;
    } catch {
      return null;
    }
  }

  function render() {
    const registering = mode === 'register';
    const roleLabel = role === 'admin' ? 'administrator' : 'user';
    const adminRegistration = registering && role === 'admin';
    roleButtons.forEach((button) => {
      const selected = button.dataset.authRole === role;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
    });
    heading.textContent = registering
      ? role === 'admin' ? 'Create administrator account' : 'Create your account'
      : `Sign in as ${roleLabel}`;
    description.textContent = registering
      ? role === 'admin'
        ? 'Use the private setup key to create an administrator account.'
        : 'Create a user account to reserve classrooms.'
      : role === 'admin'
        ? 'Access RoomQ schedule management.'
        : 'Sign in to find and reserve a classroom.';
    confirmPasswordField.hidden = !registering;
    confirmPassword.required = registering;
    adminSetupKeyField.hidden = !adminRegistration;
    adminSetupKey.required = adminRegistration;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    submit.textContent = registering
      ? role === 'admin' ? 'Create administrator account' : 'Create account'
      : 'Sign in';
    modeToggle.hidden = false;
    modeToggle.innerHTML = registering
      ? 'Already have an account? <strong>Sign in</strong>'
      : role === 'admin'
        ? 'Need an admin account? <strong>Create one</strong>'
        : 'New to RoomQ? <strong>Create a user account</strong>';
    securityNote.textContent = adminRegistration
      ? 'Admin sign-up requires the private ROOMQ_ADMIN_SIGNUP_KEY configured on the server.'
      : role === 'admin'
        ? 'Administrator credentials are managed by the RoomQ administrator.'
      : 'User accounts can reserve available classrooms. Schedule management is limited to administrators.';
    feedback.textContent = '';
  }

  roleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      role = button.dataset.authRole;
      mode = 'login';
      render();
    });
  });

  modeToggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    render();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const registering = mode === 'register';
    if (registering && password.value !== confirmPassword.value) {
      feedback.textContent = 'The passwords do not match.';
      return;
    }
    submit.disabled = true;
    feedback.textContent = '';
    try {
      const result = await window.RoomQApi.request(
        registering ? (role === 'admin' ? '/api/register-admin' : '/api/register') : '/api/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: username.value,
            password: password.value,
            role,
            ...(role === 'admin' && registering ? { setupKey: adminSetupKey.value } : {})
          })
        }
      );
      if (result.user.role !== role) {
        throw new Error('This account does not match the selected account type.');
      }
      password.value = '';
      confirmPassword.value = '';
      adminSetupKey.value = '';
      window.location.assign(role === 'admin' ? 'index.html' : getSafeReturnPath() || 'classrooms.html');
    } catch (error) {
      feedback.textContent = error.message;
      submit.disabled = false;
    }
  });

  render();
})();
