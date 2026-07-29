(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'my-trips' });
  GT.renderFooter();

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function load() {
    const data = await GT.api('/itineraries');
    const list = document.getElementById('tripsList');
    list.innerHTML = '';
    document.getElementById('emptyState').classList.toggle('hidden', data.count > 0);

    data.results.forEach((it) => {
      const row = document.createElement('a');
      row.className = 'itinerary-row';
      row.href = `/trip.html?id=${it.id}`;
      row.innerHTML = `
        <div>
          <div class="itinerary-row__title">${GT.escapeHtml(it.title)}</div>
          <div class="itinerary-row__meta">${it.items.length} stop${it.items.length === 1 ? '' : 's'} · created ${formatDate(it.createdAt)}</div>
        </div>
        <span class="pill">View trip</span>
      `;
      list.appendChild(row);
    });
  }

  load();
})();
