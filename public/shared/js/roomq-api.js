(function () {
  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin'
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new ApiError(
        payload && payload.error ? payload.error : `Request failed (${response.status}).`,
        response.status,
        payload
      );
      if (payload && payload.code) {
        error.code = payload.code;
      }
      if (payload && payload.conflict) {
        error.conflict = payload.conflict;
      }
      throw error;
    }
    return payload;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function mountAdminPanel(container, onChange = () => {}) {
    let activeUser = null;
    const render = () => {
      container.replaceChildren();
      container.classList.add('admin-session-panel');
      if (activeUser) {
        const status = makeElement('p', 'admin-session-status', `Signed in as ${activeUser.fullName || activeUser.email}`);
        const logout = makeElement('button', 'admin-session-button', 'Sign out');
        logout.type = 'button';
        logout.addEventListener('click', async () => {
          logout.disabled = true;
          try {
            await request('/api/logout', { method: 'POST', body: '{}' });
            activeUser = null;
            render();
            onChange(null);
          } catch (error) {
            logout.disabled = false;
            status.textContent = error.message;
          }
        });
        container.append(status, logout);
        return;
      }

      const form = makeElement('form', 'admin-login-form');
      const emailLabel = makeElement('label', 'admin-login-field');
      emailLabel.append(makeElement('span', '', 'Email'));
      const email = makeElement('input');
      email.type = 'email';
      email.name = 'email';
      email.autocomplete = 'email';
      email.required = true;
      emailLabel.append(email);

      const passwordLabel = makeElement('label', 'admin-login-field');
      passwordLabel.append(makeElement('span', '', 'Password'));
      const password = makeElement('input');
      password.type = 'password';
      password.name = 'password';
      password.autocomplete = 'current-password';
      password.required = true;
      passwordLabel.append(password);

      const submit = makeElement('button', 'admin-session-button', 'Sign in');
      submit.type = 'submit';
      const message = makeElement('p', 'admin-session-message');
      message.setAttribute('role', 'status');
      form.append(emailLabel, passwordLabel, submit, message);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        message.textContent = '';
        try {
          const result = await request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ email: email.value, password: password.value })
          });
          activeUser = result.user;
          password.value = '';
          render();
          onChange(activeUser);
        } catch (error) {
          message.textContent = error.message;
          submit.disabled = false;
        }
      });
      container.append(form);
    };

    request('/api/me')
      .then((result) => {
        activeUser = result.authenticated ? result.user : null;
        render();
        onChange(activeUser);
      })
      .catch((error) => {
        container.replaceChildren(makeElement('p', 'admin-session-message', error.message));
        onChange(null);
      });

    return {
      getUser: () => activeUser
    };
  }

  // Whether the signed-in user holds a permission. For showing or hiding
  // controls only; the server enforces every permission itself.
  function can(user, permission) {
    return Boolean(user && Array.isArray(user.permissions) && user.permissions.includes(permission));
  }

  window.RoomQApi = { ApiError, can, mountAdminPanel, request };
})();
