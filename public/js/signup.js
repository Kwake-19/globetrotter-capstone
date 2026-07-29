(() => {
  GT.renderHeader({ variant: 'public', active: 'signup' });

  const form = document.getElementById('signupForm');
  const formError = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');

  const fields = {
    name: document.getElementById('name'),
    username: document.getElementById('username'),
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    phone: document.getElementById('phone'),
    homeCity: document.getElementById('homeCity')
  };
  const errors = {
    name: document.getElementById('nameError'),
    username: document.getElementById('usernameError'),
    email: document.getElementById('emailError'),
    password: document.getElementById('passwordError')
  };

  function clearErrors() {
    formError.classList.add('hidden');
    Object.values(errors).forEach((el) => { el.textContent = ''; });
  }

  function validate() {
    let ok = true;
    if (!fields.name.value.trim()) {
      errors.name.textContent = 'Enter your full name.';
      ok = false;
    }
    const username = fields.username.value.trim();
    if (username.length < 3 || username.length > 30) {
      errors.username.textContent = 'Username must be 3-30 characters.';
      ok = false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.value.trim())) {
      errors.email.textContent = 'Enter a valid email address.';
      ok = false;
    }
    if (fields.password.value.length < 6) {
      errors.password.textContent = 'Password must be at least 6 characters.';
      ok = false;
    }
    return ok;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    if (!validate()) return;

    submitBtn.disabled = true;
    try {
      const data = await GT.api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: fields.name.value.trim(),
          username: fields.username.value.trim(),
          email: fields.email.value.trim(),
          password: fields.password.value,
          phone: fields.phone.value.trim(),
          homeCity: fields.homeCity.value.trim()
        })
      });
      GT.setAuth(data.token, data.user);
      window.location.href = '/app.html';
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
