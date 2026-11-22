(function () {
  const form = document.getElementById('authForm');
  const username = document.getElementById('authUsername');
  const password = document.getElementById('authPassword');
  const confirmPasswordField = document.getElementById('confirmPasswordField');
  const confirmPassword = document.getElementById('authPasswordConfirm');
  const feedback = document.getElementById('authFeedback');
  const submit = document.getElementById('authSubmit');
  const heading = document.getElementById('authHeading');
  const description = document.getElementById('authDescription');
  const modeToggle = document.getElementById('authModeToggle');
  const securityNote = document.getElementById('authSecurityNote');
  const query = new URLSearchParams(window.location.search);
  let mode = 'login';

  function getSafeReturnPath() {
    const requested = query.get('returnTo');
    if (!requested) {
      return null;
    }
    try {
      const target = new URL(requested, window.location.origin);
      return target.origin === window.location.origin && target.pathname === '/client/classrooms.html'
        ? `${target.pathname}${target.search}${target.hash}`
        : null;
    } catch {
      return null;
    }
  }

  function render() {
    const registering = mode === 'register';
    heading.textContent = registering ? 'Create your account' : 'Sign in to RoomQ';
    description.textContent = registering
      ? 'Create a user account to reserve classrooms.'
      : 'Use your administrator or user account to continue.';
    confirmPasswordField.hidden = !registering;
    confirmPassword.required = registering;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    submit.textContent = registering ? 'Create account' : 'Sign in';
    modeToggle.hidden = false;
    modeToggle.innerHTML = registering
      ? 'Already have an account? <strong>Sign in</strong>'
      : 'New to RoomQ? <strong>Create an account</strong>';
    securityNote.textContent = 'User accounts can reserve available classrooms. Schedule management is limited to administrators.';
    feedback.textContent = '';
  }

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
        registering ? '/api/register' : '/api/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: username.value,
            password: password.value
          })
        }
      );
      password.value = '';
      confirmPassword.value = '';
      window.location.assign(result.user.role === 'admin'
        ? '/admin/index.html'
        : getSafeReturnPath() || '/client/classrooms.html');
    } catch (error) {
      feedback.textContent = error.message;
      submit.disabled = false;
    }
  });

  render();
})();
