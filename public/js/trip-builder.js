(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'trip-builder' });
  GT.renderFooter();

  const params = new URLSearchParams(window.location.search);
  const editId = params.get('editId');

  let draft = []; // [{ destinationId, name, category, neighborhood }]
  const searchState = { category: '', query: '' };

  const draftListEl = document.getElementById('draftList');
  const draftEmptyEl = document.getElementById('draftEmpty');
  const tripTitleInput = document.getElementById('tripTitle');
  const builderMessage = document.getElementById('builderMessage');
  const saveBtn = document.getElementById('saveTripBtn');

  // ---- left column: search/filter -----------------------------------------
  const chipRow = document.getElementById('categoryChips');
  GT.CATEGORIES.forEach((cat) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.category = cat.id;
    chip.textContent = cat.label;
    chipRow.appendChild(chip);
  });

  function isInDraft(id) {
    return draft.some((i) => i.destinationId === id);
  }

  async function loadSearchResults() {
    const q = new URLSearchParams();
    if (searchState.category) q.set('category', searchState.category);
    if (searchState.query) q.set('q', searchState.query);
    const data = await GT.api(`/destinations?${q.toString()}`);

    const grid = document.getElementById('searchResults');
    grid.innerHTML = '';
    data.results.forEach((place) => {
      const card = document.createElement('div');
      card.className = 'builder-place-card';
      const added = isInDraft(place.id);
      card.innerHTML = `
        <div class="builder-place-card__name">${GT.escapeHtml(place.name)}</div>
        <div class="builder-place-card__meta">${GT.escapeHtml(GT.categoryLabel(place.category))} · ${GT.escapeHtml(place.neighborhood)}</div>
        <button class="btn btn-outline btn-sm" data-add="${place.id}" data-name="${GT.escapeHtml(place.name)}"
          data-category="${place.category}" data-neighborhood="${GT.escapeHtml(place.neighborhood)}" ${added ? 'disabled' : ''}>
          ${added ? 'Added' : 'Add'}
        </button>
      `;
      grid.appendChild(card);
    });
  }

  chipRow.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chipRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    searchState.category = chip.dataset.category;
    loadSearchResults();
  });
  document.getElementById('searchBtn').addEventListener('click', () => {
    searchState.query = document.getElementById('searchInput').value.trim();
    loadSearchResults();
  });
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('searchBtn').click();
  });
  document.getElementById('searchResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    addPlaceToDraft({
      destinationId: btn.dataset.add,
      name: btn.dataset.name,
      category: btn.dataset.category,
      neighborhood: btn.dataset.neighborhood
    });
    btn.textContent = 'Added';
    btn.disabled = true;
  });

  // ---- right column: draft list --------------------------------------------
  function persistDraftIfFresh() {
    if (!editId) {
      GT.saveDraftTrip(draft.map((i) => ({
        destinationId: i.destinationId, name: i.name, category: i.category, neighborhood: i.neighborhood
      })));
    }
  }

  function addPlaceToDraft(item) {
    if (isInDraft(item.destinationId)) return;
    draft.push(item);
    persistDraftIfFresh();
    renderDraft();
  }

  function removeFromDraft(id) {
    draft = draft.filter((i) => i.destinationId !== id);
    persistDraftIfFresh();
    renderDraft();
  }

  function moveDraft(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= draft.length) return;
    [draft[index], draft[target]] = [draft[target], draft[index]];
    persistDraftIfFresh();
    renderDraft();
  }

  function renderDraft() {
    draftEmptyEl.classList.toggle('hidden', draft.length > 0);
    draftListEl.innerHTML = '';
    draft.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'draft-row';
      row.innerHTML = `
        <div>
          <div class="draft-row__name">${GT.escapeHtml(item.name)}</div>
          <div class="draft-row__meta">${GT.escapeHtml(GT.categoryLabel(item.category))} · ${GT.escapeHtml(item.neighborhood)}</div>
        </div>
        <div class="draft-row__actions">
          <button class="reorder-btn" data-up="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button>
          <button class="reorder-btn" data-down="${index}" ${index === draft.length - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button>
          <button class="remove-btn" data-remove="${item.destinationId}">Remove</button>
        </div>
      `;
      draftListEl.appendChild(row);
    });
  }

  draftListEl.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    const upBtn = e.target.closest('[data-up]');
    const downBtn = e.target.closest('[data-down]');
    if (removeBtn) removeFromDraft(removeBtn.dataset.remove);
    if (upBtn) moveDraft(Number(upBtn.dataset.up), -1);
    if (downBtn) moveDraft(Number(downBtn.dataset.down), 1);
  });

  // ---- save -----------------------------------------------------------------
  saveBtn.addEventListener('click', async () => {
    builderMessage.textContent = '';
    const title = tripTitleInput.value.trim();
    if (!title) { builderMessage.textContent = 'Give your trip a name.'; return; }
    if (draft.length === 0) { builderMessage.textContent = 'Add at least one place first.'; return; }

    const items = draft.map((i) => ({ destinationId: i.destinationId }));
    saveBtn.disabled = true;
    try {
      if (editId) {
        await GT.api(`/itineraries/${editId}`, { method: 'PUT', body: JSON.stringify({ title, items }) });
        window.location.href = `/trip.html?id=${editId}&updated=1`;
      } else {
        const created = await GT.api('/itineraries', { method: 'POST', body: JSON.stringify({ title, items }) });
        GT.clearDraftTrip();
        window.location.href = `/trip.html?id=${created.id}&saved=1`;
      }
    } catch (err) {
      builderMessage.textContent = err.message;
      saveBtn.disabled = false;
    }
  });

  // ---- init -------------------------------------------------------------------
  async function init() {
    if (editId) {
      document.getElementById('draftHeading').textContent = 'Editing trip';
      try {
        const itinerary = await GT.api(`/itineraries/${editId}`);
        tripTitleInput.value = itinerary.title;
        const sorted = itinerary.items.slice().sort((a, b) => a.order - b.order);
        const destinations = await Promise.all(
          sorted.map((item) => GT.api(`/destinations/${item.destinationId}`).catch(() => null))
        );
        draft = sorted.map((item, i) => {
          const d = destinations[i];
          return {
            destinationId: item.destinationId,
            name: d ? d.name : 'Unknown place',
            category: d ? d.category : '',
            neighborhood: d ? d.neighborhood : ''
          };
        });
      } catch (err) {
        builderMessage.textContent = 'Could not load that itinerary for editing.';
      }
    } else {
      draft = GT.getDraftTrip();
    }
    renderDraft();
    loadSearchResults();
  }

  init();
})();
