/**
 * Shared frontend helpers: fetch/auth wrapper, nav rendering, the
 * localStorage draft-trip cart, and small utilities reused by every page.
 * Loaded before every page-specific script (see each .html file).
 */
(function () {
  const API_BASE = '/api';
  const TOKEN_KEY = 'gt_token';
  const USER_KEY = 'gt_user';
  const DRAFT_KEY = 'gt_draft_trip';

  const CATEGORIES = [
    { id: 'restaurant', label: 'Restaurants' },
    { id: 'ice_cream', label: 'Ice Cream & Desserts' },
    { id: 'mall', label: 'Malls & Shopping' },
    { id: 'fun_place', label: 'Fun & Attractions' },
    { id: 'hotel', label: 'Hotels' },
    { id: 'petrol_station', label: 'Petrol Stations' }
  ];

  function categoryLabel(id) {
    const found = CATEGORIES.find((c) => c.id === id);
    return found ? found.label : id;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  // ---- auth / api ---------------------------------------------------------
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }

  function setAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login.html';
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    let body = null;
    try { body = await res.json(); } catch (e) { /* e.g. 204 No Content */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /** Redirects to login if there's no token. Call at the top of protected pages. */
  function requireAuthOrRedirect() {
    if (!getToken()) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${redirect}`);
      return false;
    }
    return true;
  }

  // ---- images -----------------------------------------------------------
  /**
   * Renders an <img> for a destination, preferring a Google-enriched photo
   * (localImagePath, from scripts/enrich-places.js) over a manually-added
   * one (image, see public/assets/images/), or a plain placeholder if
   * neither exists yet. Falls back to the same placeholder if the file 404s.
   */
  function renderPlaceImage(place, className) {
    const src = place.localImagePath || place.image;
    if (!src) {
      return `<div class="${className}-fallback">No photo yet</div>`;
    }
    return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(place.name)}" loading="lazy"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${className}-fallback',textContent:'Image unavailable'}))" />`;
  }

  // ---- draft trip (localStorage cart) ---------------------------------------
  function getDraftTrip() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]'); } catch (e) { return []; }
  }

  function saveDraftTrip(items) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(items));
    updateNavBadge();
  }

  function addToDraftTrip(place) {
    const items = getDraftTrip();
    if (items.some((i) => i.destinationId === place.id)) return false;
    items.push({
      destinationId: place.id,
      name: place.name,
      category: place.category,
      neighborhood: place.neighborhood
    });
    saveDraftTrip(items);
    return true;
  }

  function removeFromDraftTrip(destinationId) {
    saveDraftTrip(getDraftTrip().filter((i) => i.destinationId !== destinationId));
  }

  function clearDraftTrip() {
    localStorage.removeItem(DRAFT_KEY);
    updateNavBadge();
  }

  function moveDraftItem(index, direction) {
    const items = getDraftTrip();
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    saveDraftTrip(items);
  }

  function updateNavBadge() {
    const badge = document.getElementById('navDraftBadge');
    if (!badge) return;
    const count = getDraftTrip().length;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  // ---- logo ---------------------------------------------------------------
  function logoMarkSvg() {
    return `<svg class="brand__mark" width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="34" height="34" rx="9" fill="#B3272C"/>
      <circle cx="17" cy="17" r="8.5" stroke="#FFFFFF" stroke-width="1.6"/>
      <path d="M21 13L15.2 15.2L13 21L18.8 18.8L21 13Z" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="17" cy="17" r="1.3" fill="#FFFFFF"/>
    </svg>`;
  }

  function brandHtml(href) {
    return `<a class="brand" href="${href || '/'}">
      ${logoMarkSvg()}
      <span class="brand__word"><b>GlobeTrotter</b><small>Yaoundé</small></span>
    </a>`;
  }

  // ---- header / nav ---------------------------------------------------------
  const AUTH_NAV_ITEMS = [
    { key: 'app', href: '/app.html', label: 'Browse' },
    { key: 'trip-builder', href: '/trip-builder.html', label: 'Build Itinerary', badge: true },
    { key: 'my-trips', href: '/my-trips.html', label: 'My Trips' },
    { key: 'profile', href: '/profile.html', label: 'Profile' }
  ];

  function renderHeader({ variant, active }) {
    const mount = document.getElementById('siteHeader');
    if (!mount) return;

    if (variant === 'public') {
      const hideLogin = active === 'login';
      const hideSignup = active === 'signup';
      mount.innerHTML = `
        <div class="site-header__inner">
          ${brandHtml('/')}
          <div class="nav-actions">
            ${hideLogin ? '' : '<a class="btn btn-outline btn-sm" href="/login.html">Log in</a>'}
            ${hideSignup ? '' : '<a class="btn btn-primary btn-sm" href="/signup.html">Sign up</a>'}
          </div>
        </div>`;
    } else if (variant === 'shared') {
      mount.innerHTML = `
        <div class="site-header__inner">
          ${brandHtml('/')}
          <div class="nav-actions">
            <a class="btn btn-primary btn-sm" href="/signup.html">Sign up to plan your own trip</a>
          </div>
        </div>`;
    } else {
      const links = AUTH_NAV_ITEMS.map((item) => {
        const isActive = item.key === active;
        const badge = item.badge ? '<span id="navDraftBadge" class="nav-badge hidden">0</span>' : '';
        return `<a class="nav-link${isActive ? ' active' : ''}" href="${item.href}">${item.label}${badge}</a>`;
      }).join('');
      mount.innerHTML = `
        <div class="site-header__inner">
          ${brandHtml('/app.html')}
          <nav class="nav-links">${links}</nav>
          <div class="nav-actions">
            <button class="btn btn-ghost btn-sm" id="navLogoutBtn">Log out</button>
          </div>
        </div>`;
      const logoutBtn = document.getElementById('navLogoutBtn');
      if (logoutBtn) logoutBtn.addEventListener('click', logout);
      updateNavBadge();
    }
  }

  function renderFooter() {
    const mount = document.getElementById('siteFooter');
    if (!mount) return;
    mount.innerHTML = `
      <div class="site-footer__inner">
        ${brandHtml('/')}
        <p>Plan your day around Yaoundé, one spot at a time.</p>
      </div>`;
  }

  window.GT = {
    CATEGORIES,
    categoryLabel,
    escapeHtml,
    api,
    getToken,
    getUser,
    setAuth,
    logout,
    requireAuthOrRedirect,
    renderPlaceImage,
    getDraftTrip,
    saveDraftTrip,
    addToDraftTrip,
    removeFromDraftTrip,
    clearDraftTrip,
    moveDraftItem,
    updateNavBadge,
    logoMarkSvg,
    brandHtml,
    renderHeader,
    renderFooter
  };
})();
