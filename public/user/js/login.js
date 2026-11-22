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
      if (target.origin !== window.location.origin) {
        return null;
      }
      let pathname = target.pathname;
      if (['/client/classrooms.html', '/users/classrooms.html'].includes(pathname)) {
        pathname = '/user/classrooms.html';
      }
      if (['/client/dashboard.html', '/users/dashboard.html'].includes(pathname)) {
        pathname = '/user/dashboard.html';
      }
      if (pathname.startsWith('/user/') || pathname.startsWith('/admin/')) {
        return `${pathname}${target.search}${target.hash}`;
      }
      return null;
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
      const returnPath = getSafeReturnPath();
      if (result.user.role === 'admin') {
        window.location.assign(returnPath || '/admin/dashboard.html');
      } else {
        const userSafePath = (returnPath && !returnPath.startsWith('/admin/'))
          ? returnPath
          : '/user/dashboard.html';
        window.location.assign(userSafePath);
      }
    } catch (error) {
      feedback.textContent = error.message;
      submit.disabled = false;
    }
  });

  render();
})();
