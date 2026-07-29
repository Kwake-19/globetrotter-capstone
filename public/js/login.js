(() => {
  GT.renderHeader({ variant: 'public', active: 'login' });

  const form = document.getElementById('loginForm');
  const formError = document.getElementById('formError');
  const identifierInput = document.getElementById('identifier');
  const passwordInput = document.getElementById('password');
  const identifierError = document.getElementById('identifierError');
  const passwordError = document.getElementById('passwordError');
  const submitBtn = document.getElementById('submitBtn');

  function clearErrors() {
    formError.classList.add('hidden');
    identifierError.textContent = '';
    passwordError.textContent = '';
  }

  function validate() {
    let ok = true;
    if (!identifierInput.value.trim()) {
      identifierError.textContent = 'Enter your email or username.';
      ok = false;
    }
    if (!passwordInput.value) {
      passwordError.textContent = 'Enter your password.';
      ok = false;
    }
    return ok;
  }

  function redirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    return redirect && redirect.startsWith('/') ? redirect : '/app.html';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    if (!validate()) return;

    submitBtn.disabled = true;
    try {
      const data = await GT.api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifierInput.value.trim(),
          password: passwordInput.value
        })
      });
      GT.setAuth(data.token, data.user);
      window.location.href = redirectTarget();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
