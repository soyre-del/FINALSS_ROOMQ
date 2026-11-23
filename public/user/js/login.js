(function () {
  const form = document.getElementById('authForm');
  const username = document.getElementById('authUsername');
  const password = document.getElementById('authPassword');
  const confirmPasswordField = document.getElementById('confirmPasswordField');
  const confirmPassword = document.getElementById('authPasswordConfirm');
  const feedback = document.getElementById('authFeedback');
  const submit = document.getElementById('authSubmit');
  const submitLabel = submit ? submit.querySelector('.auth-submit-label') : null;
  const heading = document.getElementById('authHeading');
  const description = document.getElementById('authDescription');
  const modeToggle = document.getElementById('authModeToggle');
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');
  const usernameHint = document.getElementById('usernameHint');
  const passwordHint = document.getElementById('passwordHint');
  const strengthBox = document.getElementById('passwordStrengthBox');
  const strengthBars = [...document.querySelectorAll('[data-strength-bar]')];
  const strengthLabel = document.getElementById('passwordStrengthLabel');
  const charCount = document.getElementById('passwordCharCount');
  const matchPill = document.getElementById('passwordMatchPill');
  const query = new URLSearchParams(window.location.search);

  let mode = query.get('mode') === 'register' ? 'register' : 'login';

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

  function setFeedback(message, type = 'error') {
    if (!feedback) return;
    feedback.classList.remove('is-error', 'is-success');
    if (!message) {
      feedback.textContent = '';
      return;
    }
    feedback.classList.add(type === 'success' ? 'is-success' : 'is-error');
    const icon = type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill';
    feedback.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i><span></span>`;
    feedback.querySelector('span').textContent = message;
  }

  function updatePasswordStrength() {
    if (mode !== 'register') return;
    const value = password.value || '';
    const len = value.length;

    if (charCount) {
      charCount.textContent = len >= 12 ? `${len} chars ✓` : `${len} / 12`;
      charCount.classList.toggle('is-met', len >= 12);
    }

    let score = 0;
    if (len >= 6) score += 1;
    if (len >= 12) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
    if (len === 0) score = 0;

    const levelClass = score <= 1 ? 'is-weak' : score === 2 ? 'is-fair' : score === 3 ? 'is-good' : 'is-strong';
    strengthBars.forEach((bar, idx) => {
      bar.classList.remove('is-weak', 'is-fair', 'is-good', 'is-strong');
      if (idx < score) {
        bar.classList.add(levelClass);
      }
    });

    if (strengthLabel) {
      if (len === 0) {
        strengthLabel.textContent = 'At least 12 characters';
      } else if (len < 12) {
        strengthLabel.textContent = `${12 - len} more character${12 - len === 1 ? '' : 's'} needed`;
      } else if (score <= 2) {
        strengthLabel.textContent = 'Fair — add uppercase or numbers';
      } else if (score === 3) {
        strengthLabel.textContent = 'Good password';
      } else {
        strengthLabel.textContent = 'Strong password';
      }
    }

    updatePasswordMatch();
  }

  function updatePasswordMatch() {
    if (!matchPill || mode !== 'register') return;
    const p1 = password.value;
    const p2 = confirmPassword.value;
    if (!p2) {
      matchPill.hidden = true;
      matchPill.textContent = '';
      matchPill.classList.remove('is-match', 'is-mismatch');
      return;
    }
    matchPill.hidden = false;
    const matches = p1 === p2;
    matchPill.classList.toggle('is-match', matches);
    matchPill.classList.toggle('is-mismatch', !matches);
    matchPill.textContent = matches ? 'Matches' : 'Mismatch';
  }

  function setButtonLabel(text) {
    if (submitLabel) {
      submitLabel.textContent = text;
    } else if (submit) {
      submit.textContent = text;
    }
  }

  function render() {
    const registering = mode === 'register';
    document.title = registering ? 'Create account | RoomQ' : 'Sign in | RoomQ';

    if (tabLogin && tabRegister) {
      tabLogin.classList.toggle('is-active', !registering);
      tabLogin.setAttribute('aria-selected', String(!registering));
      tabRegister.classList.toggle('is-active', registering);
      tabRegister.setAttribute('aria-selected', String(registering));
    }

    heading.textContent = registering ? 'Create your account' : 'Sign in to RoomQ';
    description.textContent = registering
      ? 'Set up a RoomQ account to reserve classrooms.'
      : 'Enter your credentials to access your account.';

    if (usernameHint) usernameHint.hidden = !registering;
    if (passwordHint) passwordHint.hidden = !registering;
    if (strengthBox) strengthBox.hidden = !registering;

    confirmPasswordField.hidden = !registering;
    confirmPassword.required = registering;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    password.placeholder = registering ? 'Create a password (12+ chars)' : 'Enter your password';
    username.placeholder = registering ? 'Choose a username' : 'Enter your username';

    setButtonLabel(registering ? 'Create account' : 'Sign in');

    modeToggle.innerHTML = registering
      ? 'Already have an account? <strong>Sign in</strong>'
      : 'New to RoomQ? <strong>Create an account</strong>';

    setFeedback('');
    if (registering) {
      updatePasswordStrength();
    } else if (matchPill) {
      matchPill.hidden = true;
    }
  }

  function switchMode(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    render();
    username.focus();
  }

  if (tabLogin) {
    tabLogin.addEventListener('click', () => switchMode('login'));
  }
  if (tabRegister) {
    tabRegister.addEventListener('click', () => switchMode('register'));
  }

  modeToggle.addEventListener('click', () => {
    switchMode(mode === 'login' ? 'register' : 'login');
  });

  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-password');
      const input = document.getElementById(targetId);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = showing ? 'bi bi-eye' : 'bi bi-eye-slash';
      }
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.title = showing ? 'Show password' : 'Hide password';
    });
  });

  password.addEventListener('input', updatePasswordStrength);
  confirmPassword.addEventListener('input', updatePasswordMatch);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const registering = mode === 'register';
    const trimmedUser = username.value.trim();

    if (trimmedUser.length < 3) {
      setFeedback('Username must be at least 3 characters long.');
      username.focus();
      return;
    }
    if (password.value.length < 12) {
      setFeedback('Password must be at least 12 characters long.');
      password.focus();
      return;
    }
    if (registering && password.value !== confirmPassword.value) {
      setFeedback('The passwords do not match.');
      confirmPassword.focus();
      return;
    }

    submit.disabled = true;
    setButtonLabel(registering ? 'Creating account…' : 'Signing in…');
    setFeedback('');

    try {
      const result = await window.RoomQApi.request(
        registering ? '/api/register' : '/api/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: trimmedUser,
            password: password.value
          })
        }
      );
      password.value = '';
      confirmPassword.value = '';
      setFeedback(registering ? 'Account created! Redirecting…' : 'Signed in! Redirecting…', 'success');
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
      setFeedback(error.message || 'Unable to complete request. Please try again.');
      submit.disabled = false;
      setButtonLabel(registering ? 'Create account' : 'Sign in');
    }
  });

  render();
})();
