(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'my-trips' });
  GT.renderFooter();

  const id = new URLSearchParams(window.location.search).get('id');
  const content = document.getElementById('tripContent');

  function notFound() {
    content.innerHTML = `
      <div class="empty-state">
        <h2>Trip not found</h2>
        <p>This itinerary doesn't exist or isn't yours.</p>
        <a href="/my-trips.html">Back to My Trips</a>
      </div>
    `;
  }

  async function render(itinerary) {
    const sorted = itinerary.items.slice().sort((a, b) => a.order - b.order);
    const destinations = await Promise.all(
      sorted.map((item) => GT.api(`/destinations/${item.destinationId}`).catch(() => null))
    );

    content.innerHTML = `
      <div class="trip-detail__head">
        <h1>${GT.escapeHtml(itinerary.title)}</h1>
      </div>
      <div class="trip-detail__actions">
        <button class="btn btn-outline" id="shareBtn">Share</button>
        <a class="btn btn-outline" href="/trip-builder.html?editId=${itinerary.id}">Edit</a>
        <button class="btn btn-danger" id="deleteBtn">Delete</button>
      </div>
      <div id="shareBoxWrap"></div>
      <div class="stop-list">
        ${sorted.map((item, i) => {
          const d = destinations[i];
          return `
            <div class="stop-row">
              <span class="stop-row__index">${i + 1}</span>
              <div class="stop-row__body">
                <div class="stop-row__name">${GT.escapeHtml(d ? d.name : 'Unknown place')}</div>
                <div class="stop-row__meta">${d ? GT.escapeHtml(GT.categoryLabel(d.category)) + ' · ' + GT.escapeHtml(d.neighborhood) : ''}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    document.getElementById('shareBtn').addEventListener('click', async () => {
      const data = await GT.api(`/itineraries/${itinerary.id}/share`, { method: 'POST' });
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      const wrap = document.getElementById('shareBoxWrap');
      wrap.innerHTML = `
        <div class="share-box">
          <input type="text" readonly value="${GT.escapeHtml(fullUrl)}" id="shareUrlInput" />
          <button class="btn btn-outline btn-sm" id="copyShareBtn">Copy</button>
        </div>
      `;
      document.getElementById('copyShareBtn').addEventListener('click', () => {
        const input = document.getElementById('shareUrlInput');
        input.select();
        navigator.clipboard.writeText(fullUrl).catch(() => {});
      });
    });

    document.getElementById('deleteBtn').addEventListener('click', async () => {
      if (!window.confirm('Delete this itinerary? This cannot be undone.')) return;
      await GT.api(`/itineraries/${itinerary.id}`, { method: 'DELETE' });
      window.location.href = '/my-trips.html';
    });
  }

  if (!id) {
    notFound();
  } else {
    GT.api(`/itineraries/${id}`).then(render).catch(notFound);
  }
})();
