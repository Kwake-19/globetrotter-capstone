(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'app' });
  GT.renderFooter();

  const state = { category: '', query: '', nearMe: null, radiusKm: 10 };

  const chipRow = document.getElementById('categoryChips');
  GT.CATEGORIES.forEach((cat) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.category = cat.id;
    chip.textContent = cat.label;
    chipRow.appendChild(chip);
  });

  function placeCard(place) {
    const card = document.createElement('div');
    card.className = 'place-card';
    const distanceLabel = typeof place.distanceKm === 'number'
      ? `<span class="place-card__distance">${place.distanceKm} km away</span>`
      : '';
    card.innerHTML = `
      ${GT.renderPlaceImage(place, 'place-card__img')}
      <div class="place-card__body">
        <div class="place-card__top">
          <h3 class="place-card__name">${GT.escapeHtml(place.name)}</h3>
          <span class="pill">${GT.escapeHtml(GT.categoryLabel(place.category))}</span>
        </div>
        <div class="place-card__meta">${GT.escapeHtml(place.neighborhood)}</div>
        <p class="place-card__desc">${GT.escapeHtml(place.description)}</p>
        <div class="place-card__footer">
          <div class="place-card__meta-group">
            <span class="place-card__rating">★ ${place.rating.toFixed(1)}</span>
            ${distanceLabel}
          </div>
          <div style="display:flex; gap:8px;">
            <a class="btn btn-outline btn-sm" href="/place.html?id=${encodeURIComponent(place.id)}">View details</a>
            <button class="btn btn-primary btn-sm" data-add="${place.id}" data-name="${GT.escapeHtml(place.name)}" data-category="${place.category}" data-neighborhood="${GT.escapeHtml(place.neighborhood)}">Add to trip</button>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  const FALLBACK_NOTES = {
    'category-popular': 'No exact matches - here are some popular options',
    popular: 'No exact matches - here are some popular places'
  };

  async function loadPlaces() {
    const aiBadgeEl = document.getElementById('aiSearchBadge');
    const fallbackNoteEl = document.getElementById('searchFallbackNote');
    let data;

    if (state.nearMe) {
      // "Near me" and category chips combine (server-side radius +
      // category filter); it takes precedence over a stale text query.
      const params = new URLSearchParams({
        lat: state.nearMe.latitude,
        lng: state.nearMe.longitude,
        radiusKm: state.radiusKm
      });
      if (state.category) params.set('category', state.category);
      data = await GT.api(`/destinations/nearby?${params.toString()}`);
      if (aiBadgeEl) aiBadgeEl.classList.add('hidden');
      if (fallbackNoteEl) fallbackNoteEl.classList.add('hidden');
    } else if (state.query) {
      // Free-text queries go through smart-search, which ranks every
      // place by relevance (AI-parsed + synonym-table signals) rather
      // than hard-filtering - it always returns something, so this call
      // never needs a separate "AI failed" error path.
      data = await GT.api(`/destinations/smart-search?q=${encodeURIComponent(state.query)}`);
      if (state.category) {
        data = { ...data, results: data.results.filter((p) => p.category === state.category) };
        data.count = data.results.length;
      }
      if (aiBadgeEl) aiBadgeEl.classList.toggle('hidden', !data.aiParsed);
      if (fallbackNoteEl) {
        const note = FALLBACK_NOTES[data.fallback];
        fallbackNoteEl.textContent = note || '';
        fallbackNoteEl.classList.toggle('hidden', !note);
      }
    } else {
      const params = new URLSearchParams();
      if (state.category) params.set('category', state.category);
      data = await GT.api(`/destinations?${params.toString()}`);
      if (aiBadgeEl) aiBadgeEl.classList.add('hidden');
      if (fallbackNoteEl) fallbackNoteEl.classList.add('hidden');
    }

    const grid = document.getElementById('placesGrid');
    grid.innerHTML = '';
    document.getElementById('resultsCount').textContent = `${data.count} place${data.count === 1 ? '' : 's'}`;
    document.getElementById('emptyState').classList.toggle('hidden', data.count > 0);
    data.results.forEach((place) => grid.appendChild(placeCard(place)));
  }

  function updateResultsTitle() {
    document.getElementById('resultsTitle').textContent = state.nearMe
      ? 'Near you'
      : (state.category ? GT.categoryLabel(state.category) : 'All places');
  }

  chipRow.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chipRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.category = chip.dataset.category;
    // "Near me" stays active across a chip click - the chip becomes a
    // category filter on top of the nearby search, not a mode switch.
    updateResultsTitle();
    loadPlaces();
  });

  document.getElementById('searchBtn').addEventListener('click', () => {
    state.query = document.getElementById('searchInput').value.trim();
    if (state.nearMe) {
      state.nearMe = null;
      setNearMeUI(false);
    }
    updateResultsTitle();
    loadPlaces();
  });
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('searchBtn').click();
  });

  const nearMeBtn = document.getElementById('nearMeBtn');
  const nearMeControls = document.getElementById('nearMeControls');
  const nearMeError = document.getElementById('nearMeError');
  const radiusSelect = document.getElementById('radiusSelect');

  function setNearMeUI(active) {
    nearMeBtn.classList.toggle('active', active);
    nearMeControls.classList.toggle('hidden', !active);
  }

  nearMeBtn.addEventListener('click', async () => {
    nearMeError.textContent = '';

    if (state.nearMe) {
      // Toggle off - back to the normal browse listing.
      state.nearMe = null;
      setNearMeUI(false);
      updateResultsTitle();
      loadPlaces();
      return;
    }

    nearMeBtn.disabled = true;
    try {
      state.nearMe = await GT.getCurrentPosition();
      // A location-based search and a free-text search are different
      // modes - starting one clears the other's input for clarity.
      state.query = '';
      document.getElementById('searchInput').value = '';
      setNearMeUI(true);
      updateResultsTitle();
      await loadPlaces();
    } catch (err) {
      nearMeError.textContent = 'Enable location access to search near you.';
    } finally {
      nearMeBtn.disabled = false;
    }
  });

  radiusSelect.addEventListener('change', () => {
    state.radiusKm = Number(radiusSelect.value);
    if (state.nearMe) loadPlaces();
  });

  document.getElementById('placesGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    GT.addToDraftTrip({
      id: btn.dataset.add,
      name: btn.dataset.name,
      category: btn.dataset.category,
      neighborhood: btn.dataset.neighborhood
    });
    btn.textContent = 'Added';
    btn.disabled = true;
  });

  loadPlaces();
})();
