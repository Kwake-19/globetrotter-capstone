(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'feed' });
  GT.renderFooter();

  const list = document.getElementById('feedList');
  const emptyState = document.getElementById('emptyState');

  function timeAgo(iso) {
    const secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    const units = [['d', 86400], ['h', 3600], ['m', 60]];
    for (const [label, size] of units) {
      if (secs >= size) return `${Math.floor(secs / size)}${label} ago`;
    }
    return 'just now';
  }

  function stars(rating) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  function reviewItem(item) {
    const d = item.destination;
    const thumb = d.photo
      ? `<img class="feed-item__thumb" src="${GT.escapeHtml(d.photo)}" alt="" loading="lazy" />`
      : '<div class="feed-item__thumb feed-item__thumb--empty"></div>';
    return `
      <a class="feed-item" href="/place.html?id=${encodeURIComponent(d.id)}">
        ${thumb}
        <div class="feed-item__body">
          <div class="feed-item__line">
            <strong>@${GT.escapeHtml(item.actor.username)}</strong> reviewed
            <strong>${GT.escapeHtml(d.name)}</strong>
            <span class="feed-item__stars">${stars(item.rating)}</span>
          </div>
          <div class="feed-item__snippet">${GT.escapeHtml(item.text)}</div>
          <div class="feed-item__meta">${GT.escapeHtml(GT.categoryLabel(d.category))} · ${GT.escapeHtml(d.neighborhood)} · ${timeAgo(item.createdAt)}</div>
        </div>
      </a>
    `;
  }

  function itineraryItem(item) {
    const it = item.itinerary;
    return `
      <a class="feed-item" href="/shared.html?shareId=${encodeURIComponent(it.shareId)}">
        <div class="feed-item__thumb feed-item__thumb--trip">🧭</div>
        <div class="feed-item__body">
          <div class="feed-item__line">
            <strong>@${GT.escapeHtml(item.actor.username)}</strong> shared a trip:
            <strong>${GT.escapeHtml(it.title)}</strong>
          </div>
          <div class="feed-item__meta">${it.stopCount} stop${it.stopCount === 1 ? '' : 's'} · ${timeAgo(item.createdAt)}</div>
        </div>
      </a>
    `;
  }

  async function load() {
    let data;
    try {
      data = await GT.api('/feed');
    } catch (err) {
      list.innerHTML = `<p class="form-error">${GT.escapeHtml(err.message)}</p>`;
      return;
    }

    emptyState.classList.toggle('hidden', data.results.length > 0);
    list.innerHTML = data.results
      .map((item) => (item.type === 'review' ? reviewItem(item) : itineraryItem(item)))
      .join('');
  }

  load();
})();
