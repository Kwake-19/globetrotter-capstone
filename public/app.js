(function () {
  const state = {
    token: localStorage.getItem('gt_token') || null,
    username: localStorage.getItem('gt_username') || null,
    destinations: [],
    selectedIds: [],
  };

  const els = {
    authStatus: document.getElementById('authStatus'),
    sharedView: document.getElementById('sharedView'),
    sharedContent: document.getElementById('sharedContent'),
    mainView: document.getElementById('mainView'),
    authPanel: document.getElementById('authPanel'),
    showLogin: document.getElementById('showLogin'),
    showRegister: document.getElementById('showRegister'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    loginMessage: document.getElementById('loginMessage'),
    registerMessage: document.getElementById('registerMessage'),
    placesGrid: document.getElementById('placesGrid'),
    itineraryBuilder: document.getElementById('itineraryBuilder'),
    itineraryForm: document.getElementById('itineraryForm'),
    itineraryMessage: document.getElementById('itineraryMessage'),
    selectedDestinations: document.getElementById('selectedDestinations'),
    myItinerariesPanel: document.getElementById('myItinerariesPanel'),
    myItineraries: document.getElementById('myItineraries'),
  };

  function setMessage(el, text, isSuccess) {
    el.textContent = text;
    el.classList.toggle('success', Boolean(isSuccess));
  }

  function renderAuthStatus() {
    if (state.token) {
      els.authStatus.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = `Signed in as ${state.username} `;
      const btn = document.createElement('button');
      btn.textContent = 'Log out';
      btn.addEventListener('click', logout);
      els.authStatus.appendChild(span);
      els.authStatus.appendChild(btn);

      els.authPanel.classList.add('hidden');
      els.itineraryBuilder.classList.remove('hidden');
      els.myItinerariesPanel.classList.remove('hidden');
      loadMyItineraries();
    } else {
      els.authStatus.textContent = '';
      els.authPanel.classList.remove('hidden');
      els.itineraryBuilder.classList.add('hidden');
      els.myItinerariesPanel.classList.add('hidden');
    }
  }

  function logout() {
    state.token = null;
    state.username = null;
    localStorage.removeItem('gt_token');
    localStorage.removeItem('gt_username');
    renderAuthStatus();
  }

  function authHeaders() {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
  }

  async function loadDestinations() {
    const res = await fetch('/api/destinations');
    state.destinations = await res.json();
    renderPlacesGrid();
  }

  function renderPlacesGrid() {
    els.placesGrid.innerHTML = '';
    state.destinations.forEach((dest) => {
      const card = document.createElement('div');
      card.className = 'place-card';
      card.dataset.id = dest.id;
      if (state.selectedIds.includes(dest.id)) card.classList.add('selected');

      card.innerHTML = `
        <img src="${dest.imageUrl}" alt="${dest.name}" />
        <div class="place-body">
          <h3>${dest.name}</h3>
          <p>${dest.country} &middot; $${dest.avgCostPerDay}/day</p>
        </div>
      `;
      card.addEventListener('click', () => toggleSelection(dest.id));
      els.placesGrid.appendChild(card);
    });
  }

  function toggleSelection(id) {
    if (!state.token) return;
    const idx = state.selectedIds.indexOf(id);
    if (idx !== -1) {
      state.selectedIds.splice(idx, 1);
    } else {
      if (state.selectedIds.length >= 2) {
        state.selectedIds.shift();
      }
      state.selectedIds.push(id);
    }
    renderPlacesGrid();
    renderSelectedDestinations();
  }

  function renderSelectedDestinations() {
    if (state.selectedIds.length === 0) {
      els.selectedDestinations.textContent = 'No destinations selected';
      return;
    }
    const names = state.selectedIds
      .map((id) => state.destinations.find((d) => d.id === id))
      .filter(Boolean)
      .map((d) => d.name);
    els.selectedDestinations.textContent = `Selected: ${names.join(', ')}`;
  }

  async function loadMyItineraries() {
    const res = await fetch('/api/itineraries', { headers: authHeaders() });
    if (!res.ok) return;
    const itineraries = await res.json();
    els.myItineraries.innerHTML = '';

    if (itineraries.length === 0) {
      els.myItineraries.textContent = 'No itineraries yet.';
      return;
    }

    itineraries.forEach((it) => {
      const card = document.createElement('div');
      card.className = 'itinerary-card';
      const destNames = it.destinations.map((d) => d.name).join(', ');
      card.innerHTML = `
        <h3>${it.title}</h3>
        <p>${destNames}</p>
        <p>${it.startDate || ''} ${it.endDate ? '&ndash; ' + it.endDate : ''}</p>
        ${it.notes ? `<p>${it.notes}</p>` : ''}
      `;

      const shareBtn = document.createElement('button');
      shareBtn.textContent = it.shareToken ? 'Copy Share Link' : 'Share';
      shareBtn.addEventListener('click', () => shareItinerary(it.id, card));
      card.appendChild(shareBtn);

      if (it.shareToken) {
        appendShareLink(card, it.shareToken);
      }

      els.myItineraries.appendChild(card);
    });
  }

  function appendShareLink(card, shareToken) {
    const linkEl = document.createElement('p');
    linkEl.className = 'share-link';
    const url = `${window.location.origin}/?share=${shareToken}`;
    linkEl.textContent = url;
    card.appendChild(linkEl);
  }

  async function shareItinerary(id, card) {
    const res = await fetch(`/api/itineraries/${id}/share`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) return;
    const { shareToken } = await res.json();
    appendShareLink(card, shareToken);
  }

  els.showLogin.addEventListener('click', () => {
    els.showLogin.classList.add('active');
    els.showRegister.classList.remove('active');
    els.loginForm.classList.remove('hidden');
    els.registerForm.classList.add('hidden');
  });

  els.showRegister.addEventListener('click', () => {
    els.showRegister.classList.add('active');
    els.showLogin.classList.remove('active');
    els.registerForm.classList.remove('hidden');
    els.loginForm.classList.add('hidden');
  });

  els.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(els.registerMessage, data.error || 'Registration failed', false);
      return;
    }
    setMessage(els.registerMessage, 'Registered! You can now log in.', true);
    els.registerForm.reset();
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(els.loginMessage, data.error || 'Login failed', false);
      return;
    }

    state.token = data.token;
    state.username = username;
    localStorage.setItem('gt_token', state.token);
    localStorage.setItem('gt_username', state.username);
    setMessage(els.loginMessage, '', true);
    els.loginForm.reset();
    renderAuthStatus();
  });

  els.itineraryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.selectedIds.length === 0) {
      setMessage(els.itineraryMessage, 'Select 1-2 destinations from the Places grid first.', false);
      return;
    }

    const body = {
      title: document.getElementById('itineraryTitle').value,
      destinationIds: state.selectedIds,
      startDate: document.getElementById('itineraryStart').value,
      endDate: document.getElementById('itineraryEnd').value,
      notes: document.getElementById('itineraryNotes').value,
    };

    const res = await fetch('/api/itineraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(els.itineraryMessage, data.error || 'Could not create itinerary', false);
      return;
    }

    setMessage(els.itineraryMessage, 'Itinerary created!', true);
    els.itineraryForm.reset();
    state.selectedIds = [];
    renderPlacesGrid();
    renderSelectedDestinations();
    loadMyItineraries();
  });

  async function renderSharedViewIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    if (!shareToken) return false;

    els.mainView.classList.add('hidden');
    els.sharedView.classList.remove('hidden');

    const res = await fetch(`/api/itineraries/shared/${shareToken}`);
    if (!res.ok) {
      els.sharedContent.textContent = 'This shared itinerary could not be found.';
      return true;
    }
    const it = await res.json();
    const destNames = it.destinations.map((d) => d.name).join(', ');
    els.sharedContent.innerHTML = `
      <h3>${it.title}</h3>
      <p>${destNames}</p>
      <p>${it.startDate || ''} ${it.endDate ? '&ndash; ' + it.endDate : ''}</p>
      ${it.notes ? `<p>${it.notes}</p>` : ''}
    `;
    return true;
  }

  async function init() {
    const showedShared = await renderSharedViewIfNeeded();
    if (showedShared) {
      await loadDestinations();
      return;
    }
    renderAuthStatus();
    await loadDestinations();
  }

  init();
})();
