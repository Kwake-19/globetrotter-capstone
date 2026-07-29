(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'profile' });
  GT.renderFooter();

  const form = document.getElementById('profileForm');
  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const nameInput = document.getElementById('name');
  const nameError = document.getElementById('nameError');
  const phoneInput = document.getElementById('phone');
  const homeCityInput = document.getElementById('homeCity');
  const submitBtn = document.getElementById('submitBtn');

  async function load() {
    const user = await GT.api('/profile');
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileUsername').textContent = user.username;
    nameInput.value = user.name || '';
    phoneInput.value = user.phone || '';
    homeCityInput.value = user.homeCity || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');
    formSuccess.classList.add('hidden');
    nameError.textContent = '';

    if (!nameInput.value.trim()) {
      nameError.textContent = 'Name cannot be empty.';
      return;
    }

    submitBtn.disabled = true;
    try {
      const user = await GT.api('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: nameInput.value.trim(),
          phone: phoneInput.value.trim(),
          homeCity: homeCityInput.value.trim()
        })
      });
      const stored = GT.getUser() || {};
      GT.setAuth(GT.getToken(), { ...stored, ...user });
      formSuccess.classList.remove('hidden');
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });

  load();
})();
