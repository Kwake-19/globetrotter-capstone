(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'app' });
  GT.renderFooter();

  const state = { category: '', query: '' };

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
          <span class="place-card__rating">★ ${place.rating.toFixed(1)}</span>
          <div style="display:flex; gap:8px;">
            <a class="btn btn-outline btn-sm" href="/place.html?id=${encodeURIComponent(place.id)}">View details</a>
            <button class="btn btn-primary btn-sm" data-add="${place.id}" data-name="${GT.escapeHtml(place.name)}" data-category="${place.category}" data-neighborhood="${GT.escapeHtml(place.neighborhood)}">Add to trip</button>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  async function loadPlaces() {
    const understoodEl = document.getElementById('searchUnderstood');
    let data;

    if (state.query) {
      // Free-text queries go through the natural-language search, which
      // understands intent (e.g. "cozy place with good grilled fish"),
      // not just literal substring matches.
      data = await GT.api(`/search?q=${encodeURIComponent(state.query)}`);
      if (state.category) {
        data = { ...data, results: data.results.filter((p) => p.category === state.category) };
        data.count = data.results.length;
      }
      if (understoodEl) {
        understoodEl.textContent = data.understood
          ? `Understood as: ${GT.categoryLabel(data.understood.category) || 'any category'}${data.understood.keywords.length ? ' · ' + data.understood.keywords.join(', ') : ''}`
          : '';
        understoodEl.classList.toggle('hidden', !data.understood);
      }
    } else {
      const params = new URLSearchParams();
      if (state.category) params.set('category', state.category);
      data = await GT.api(`/destinations?${params.toString()}`);
      if (understoodEl) understoodEl.classList.add('hidden');
    }

    const grid = document.getElementById('placesGrid');
    grid.innerHTML = '';
    document.getElementById('resultsCount').textContent = `${data.count} place${data.count === 1 ? '' : 's'}`;
    document.getElementById('emptyState').classList.toggle('hidden', data.count > 0);
    data.results.forEach((place) => grid.appendChild(placeCard(place)));
  }

  chipRow.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chipRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.category = chip.dataset.category;
    document.getElementById('resultsTitle').textContent = state.category ? GT.categoryLabel(state.category) : 'All places';
    loadPlaces();
  });

  document.getElementById('searchBtn').addEventListener('click', () => {
    state.query = document.getElementById('searchInput').value.trim();
    loadPlaces();
  });
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('searchBtn').click();
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
