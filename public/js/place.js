(() => {
  GT.renderHeader({ variant: 'auth', active: 'place' });
  GT.renderFooter();

  const content = document.getElementById('placeContent');

  function notFound() {
    content.innerHTML = `
      <div class="empty-state">
        <h2>Place not found</h2>
        <p>We couldn't find that place — it may have been removed.</p>
        <a href="/app.html">Back to Browse</a>
      </div>
    `;
  }

  function render(place) {
    content.innerHTML = `
      ${GT.renderPlaceImage(place, 'place-detail__img')}
      <div class="place-detail__head">
        <h1>${GT.escapeHtml(place.name)}</h1>
        <span class="pill">${GT.escapeHtml(GT.categoryLabel(place.category))}</span>
      </div>
      <div class="place-detail__meta-row">
        <span>${GT.escapeHtml(place.neighborhood)}</span>
        <span class="rating">★ ${place.rating.toFixed(1)}</span>
        <span>${GT.escapeHtml(place.address)}</span>
      </div>
      <p>${GT.escapeHtml(place.description)}</p>
      <div class="place-detail__tags">
        ${(place.tags || []).map((tag) => `<span class="pill">${GT.escapeHtml(tag)}</span>`).join('')}
      </div>
      <div class="place-detail__actions">
        <button class="btn btn-primary" id="addBtn">Add to trip</button>
        <a class="btn btn-outline" href="${GT.mapsUrl(place)}" target="_blank" rel="noopener">Open in Google Maps</a>
        <a class="btn btn-outline" href="/app.html">Back to Browse</a>
      </div>
    `;

    const addBtn = document.getElementById('addBtn');
    const alreadyAdded = GT.getDraftTrip().some((i) => i.destinationId === place.id);
    if (alreadyAdded) {
      addBtn.textContent = 'Added';
      addBtn.disabled = true;
    }
    addBtn.addEventListener('click', () => {
      GT.addToDraftTrip(place);
      addBtn.textContent = 'Added';
      addBtn.disabled = true;
    });
  }

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    notFound();
  } else {
    GT.api(`/destinations/${encodeURIComponent(id)}`)
      .then(render)
      .catch(notFound);
  }
})();
