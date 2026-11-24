(function () {
  const form = document.getElementById('authForm');
  const firstNameField = document.getElementById('firstNameField');
  const firstName = document.getElementById('authFirstName');
  const middleNameField = document.getElementById('middleNameField');
  const middleName = document.getElementById('authMiddleName');
  const lastNameField = document.getElementById('lastNameField');
  const lastName = document.getElementById('authLastName');
  const email = document.getElementById('authEmail');
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
  const passwordHint = document.getElementById('passwordHint');
  const strengthBox = document.getElementById('passwordStrengthBox');
  const strengthBars = [...document.querySelectorAll('[data-strength-bar]')];
  const strengthLabel = document.getElementById('passwordStrengthLabel');
  const charCount = document.getElementById('passwordCharCount');
  const matchPill = document.getElementById('passwordMatchPill');
  const query = new URLSearchParams(window.location.search);
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      if (pathname.startsWith('/user/') || pathname.startsWith('/admin/') || pathname.startsWith('/staff/')) {
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
      : 'Enter your email and password to access your account.';

    if (firstNameField) firstNameField.hidden = !registering;
    if (middleNameField) middleNameField.hidden = !registering;
    if (lastNameField) lastNameField.hidden = !registering;
    if (firstName) firstName.required = registering;
    if (lastName) lastName.required = registering;
    if (passwordHint) passwordHint.hidden = !registering;
    if (strengthBox) strengthBox.hidden = !registering;

    confirmPasswordField.hidden = !registering;
    confirmPassword.required = registering;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    password.placeholder = registering ? 'Create a password (12+ chars)' : 'Enter your password';
    if (email) {
      email.placeholder = registering ? 'Enter your email address' : 'Enter your email';
    }

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
    if (mode === 'register' && firstName) {
      firstName.focus();
    } else if (email) {
      email.focus();
    }
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
    const trimmedEmail = email ? email.value.trim() : '';
    const trimmedFirst = firstName ? firstName.value.trim() : '';
    const trimmedMiddle = middleName ? middleName.value.trim() : '';
    const trimmedLast = lastName ? lastName.value.trim() : '';

    if (registering) {
      if (!trimmedFirst) {
        setFeedback('Enter your first name.');
        if (firstName) firstName.focus();
        return;
      }
      if (!trimmedLast) {
        setFeedback('Enter your last name.');
        if (lastName) lastName.focus();
        return;
      }
      if (!EMAIL_PATTERN.test(trimmedEmail)) {
        setFeedback('Enter a valid email address.');
        if (email) email.focus();
        return;
      }
      if (password.value.length < 12) {
        setFeedback('Password must be at least 12 characters long.');
        password.focus();
        return;
      }
      if (password.value !== confirmPassword.value) {
        setFeedback('The passwords do not match.');
        confirmPassword.focus();
        return;
      }
    } else {
      if (!trimmedEmail) {
        setFeedback('Enter your email address.');
        if (email) email.focus();
        return;
      }
      if (!password.value) {
        setFeedback('Enter your password.');
        password.focus();
        return;
      }
    }

    submit.disabled = true;
    setButtonLabel(registering ? 'Creating account…' : 'Signing in…');
    setFeedback('');

    try {
      const payload = registering
        ? {
          firstName: trimmedFirst,
          middleName: trimmedMiddle || undefined,
          lastName: trimmedLast,
          email: trimmedEmail,
          password: password.value
        }
        : {
          email: trimmedEmail,
          password: password.value
        };
      const result = await window.RoomQApi.request(
        registering ? '/api/register' : '/api/login',
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      password.value = '';
      confirmPassword.value = '';
      setFeedback(registering ? 'Account created! Redirecting…' : 'Signed in! Redirecting…', 'success');
      // Each role goes to its own portal; a return link is honoured only when
      // it stays inside that portal or the public user area.
      const returnPath = getSafeReturnPath();
      const portal = { admin: '/admin/', staff: '/staff/' }[result.user.role] || '/user/';
      const allowedReturn = returnPath &&
        (returnPath.startsWith(portal) || returnPath.startsWith('/user/'));
      window.location.assign(allowedReturn ? returnPath : `${portal}dashboard.html`);
    } catch (error) {
      setFeedback(error.message || 'Unable to complete request. Please try again.');
      submit.disabled = false;
      setButtonLabel(registering ? 'Create account' : 'Sign in');
    }
  });

  render();
})();
