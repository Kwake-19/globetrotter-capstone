(() => {
  GT.renderHeader({ variant: 'shared' });
  GT.renderFooter();

  const shareId = new URLSearchParams(window.location.search).get('shareId');
  const content = document.getElementById('tripContent');

  function notFound() {
    content.innerHTML = `
      <div class="empty-state">
        <h2>Shared trip not found</h2>
        <p>This link may be invalid or the trip is no longer shared.</p>
      </div>
    `;
  }

  function render(data) {
    document.getElementById('tripTitle').textContent = data.title;
    document.getElementById('banner').classList.remove('hidden');

    const sorted = data.items.slice().sort((a, b) => a.order - b.order);
    content.innerHTML = `
      <div class="stop-list">
        ${sorted.map((item, i) => {
          const d = item.destination;
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
  }

  if (!shareId) {
    notFound();
  } else {
    GT.api(`/shared/${encodeURIComponent(shareId)}`).then(render).catch(notFound);
  }
})();
