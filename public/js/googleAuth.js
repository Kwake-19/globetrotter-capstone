/**
 * Shared "Sign in with Google" wiring for login.html and signup.html.
 * Loaded after api.js and before the page's own login.js/signup.js.
 *
 * The Google client ID is never baked into a static JS file - it's
 * fetched from GET /api/config (same pattern as googleMapsEmbedKey). If
 * it isn't configured server-side, the button container and divider
 * simply stay hidden - the existing email/username form is unaffected.
 */
(() => {
  const container = document.getElementById('googleSignInContainer');
  if (!container) return;

  const divider = document.getElementById('googleAuthDivider');
  const formError = document.getElementById('formError');

  function showError(message) {
    if (!formError) return;
    formError.textContent = message;
    formError.classList.remove('hidden');
  }

  async function handleCredentialResponse(response) {
    try {
      const data = await GT.api('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: response.credential })
      });
      GT.setAuth(data.token, data.user);
      window.location.href = '/app.html';
    } catch (err) {
      showError(err.message);
    }
  }

  function loadGoogleScript() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
      document.head.appendChild(script);
    });
  }

  async function init() {
    let config;
    try {
      config = await GT.api('/config');
    } catch (err) {
      return; // Config unavailable - leave the button hidden.
    }

    if (!config.googleClientId) return; // Not configured - leave the button hidden.

    try {
      await loadGoogleScript();
    } catch (err) {
      return; // Network hiccup loading Google's script - fail quietly, not a broken button.
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleCredentialResponse
    });
    window.google.accounts.id.renderButton(container, {
      theme: 'outline',
      size: 'large',
      width: 360
    });

    container.classList.remove('hidden');
    if (divider) divider.classList.remove('hidden');
  }

  init();
})();
