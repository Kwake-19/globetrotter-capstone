(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'my-trips' });
  GT.renderFooter();

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const justSaved = params.get('saved') === '1';
  const justUpdated = params.get('updated') === '1';
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

    const banner = justSaved
      ? '<div class="form-success">Itinerary saved! Ready to share it?</div>'
      : justUpdated
        ? '<div class="form-success">Itinerary updated.</div>'
        : '';

    function visitedCount() {
      return sorted.filter((item) => item.visited).length;
    }

    function renderStops() {
      const stopList = document.getElementById('stopList');
      const progress = document.getElementById('tripProgress');
      if (progress) progress.textContent = `${visitedCount()} of ${sorted.length} visited`;
      if (!stopList) return;
      stopList.innerHTML = sorted.map((item, i) => {
        const d = destinations[i];
        return `
          <div class="stop-row${item.visited ? ' stop-row--visited' : ''}">
            <input type="checkbox" class="stop-row__checkbox" data-destination-id="${item.destinationId}"
              ${item.visited ? 'checked' : ''} aria-label="Mark ${d ? GT.escapeHtml(d.name) : 'stop'} as visited" />
            <span class="stop-row__index">${i + 1}</span>
            <div class="stop-row__body">
              <div class="stop-row__name">${GT.escapeHtml(d ? d.name : 'Unknown place')}</div>
              <div class="stop-row__meta">${d ? GT.escapeHtml(GT.categoryLabel(d.category)) + ' · ' + GT.escapeHtml(d.neighborhood) : ''}</div>
            </div>
            ${d ? `<button class="btn btn-outline btn-sm" data-directions="${item.destinationId}">Get Directions</button>` : ''}
          </div>
        `;
      }).join('');
    }

    // ---- inline directions map (shared by every stop's "Get Directions" button) ----
    let mapConfig = null;
    async function getMapConfig() {
      if (!mapConfig) {
        mapConfig = await GT.api('/config').catch(() => ({ googleMapsEmbedKey: null }));
      }
      return mapConfig;
    }

    async function showDirectionsTo(destinationId) {
      const mapSection = document.getElementById('tripMapSection');
      const idx = sorted.findIndex((i) => i.destinationId === destinationId);
      const place = destinations[idx];

      mapSection.classList.remove('hidden');
      mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
        mapSection.innerHTML = `<h2>Directions</h2><div class="map-unavailable"><p>Location unavailable for this stop.</p></div>`;
        return;
      }

      const config = await getMapConfig();
      if (!config.googleMapsEmbedKey) {
        mapSection.innerHTML = `
          <h2>Directions to ${GT.escapeHtml(place.name)}</h2>
          <div class="map-unavailable"><p>Map unavailable.</p><p>${GT.escapeHtml(place.address || '')}</p></div>
        `;
        return;
      }

      mapSection.innerHTML = `
        <h2>Directions to ${GT.escapeHtml(place.name)}</h2>
        <div class="map-note">Getting your location&hellip;</div>
        <div class="field__error" id="tripMapError"></div>
      `;

      if (!navigator.geolocation) {
        mapSection.querySelector('.map-note').remove();
        document.getElementById('tripMapError').textContent = 'Enable location access to get directions from where you are.';
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude: userLat, longitude: userLng } = position.coords;
          const url = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(config.googleMapsEmbedKey)}&origin=${userLat},${userLng}&destination=${place.latitude},${place.longitude}&mode=driving`;
          mapSection.innerHTML = `
            <h2>Directions to ${GT.escapeHtml(place.name)}</h2>
            <iframe class="map-frame" src="${url}" loading="lazy"
              referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
            <div class="map-controls">
              <div class="map-note">Showing driving directions from your current location.</div>
              <button class="link-btn" id="closeTripMapBtn">Close</button>
            </div>
          `;
          document.getElementById('closeTripMapBtn').addEventListener('click', () => {
            mapSection.classList.add('hidden');
            mapSection.innerHTML = '';
          });
        },
        () => {
          mapSection.innerHTML = `
            <h2>Directions to ${GT.escapeHtml(place.name)}</h2>
            <div class="field__error">We couldn't get your location — check your browser's location permission and try again.</div>
          `;
        }
      );
    }

    content.innerHTML = `
      <div class="trip-detail__head">
        <h1>${GT.escapeHtml(itinerary.title)}</h1>
        <span class="results-count" id="tripProgress">${visitedCount()} of ${sorted.length} visited</span>
      </div>
      ${banner}
      <div class="trip-detail__actions">
        <button class="btn ${justSaved ? 'btn-primary' : 'btn-outline'}" id="shareBtn">Share</button>
        <a class="btn btn-outline" href="/trip-builder.html?editId=${itinerary.id}">Edit</a>
        <button class="btn btn-danger" id="deleteBtn">Delete</button>
      </div>
      <div id="shareBoxWrap"></div>
      <div class="stop-list" id="stopList"></div>
      <section class="map-section hidden" id="tripMapSection"></section>
    `;
    renderStops();

    if (justSaved || justUpdated) {
      window.history.replaceState({}, '', `/trip.html?id=${itinerary.id}`);
    }

    document.getElementById('stopList').addEventListener('change', async (e) => {
      const checkbox = e.target.closest('.stop-row__checkbox');
      if (!checkbox) return;
      const destinationId = checkbox.dataset.destinationId;
      const item = sorted.find((i) => i.destinationId === destinationId);
      const nextVisited = checkbox.checked;

      item.visited = nextVisited; // optimistic
      renderStops();

      try {
        await GT.api(`/itineraries/${itinerary.id}/items/${encodeURIComponent(destinationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ visited: nextVisited })
        });
      } catch (err) {
        item.visited = !nextVisited; // revert on failure
        renderStops();
      }
    });

    document.getElementById('stopList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-directions]');
      if (!btn) return;
      showDirectionsTo(btn.dataset.directions);
    });

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
