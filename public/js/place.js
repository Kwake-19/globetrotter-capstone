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

  function ratingLabel(place) {
    return typeof place.rating === 'number' ? `★ ${place.rating.toFixed(1)}` : 'No rating yet';
  }

  async function renderLocationSection(place) {
    const section = document.getElementById('locationSection');

    let config;
    try {
      config = await GT.api('/config');
    } catch (err) {
      config = { googleMapsEmbedKey: null };
    }

    if (!config.googleMapsEmbedKey) {
      section.innerHTML = `
        <h2>Location</h2>
        <div class="map-unavailable">
          <p>Map unavailable.</p>
          <p>${GT.escapeHtml(place.address)}</p>
        </div>
      `;
      return;
    }

    const key = config.googleMapsEmbedKey;
    const placeQuery = place.placeId ? `place_id:${place.placeId}` : `${place.latitude},${place.longitude}`;
    const placeEmbedUrl = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(placeQuery)}`;

    section.innerHTML = `
      <h2>Location</h2>
      <iframe class="map-frame" id="mapFrame" src="${placeEmbedUrl}" loading="lazy"
        referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
      <div class="map-controls">
        <button class="btn btn-outline btn-sm" id="directionsBtn">Get Directions</button>
        <div id="mapNote" class="map-note hidden"></div>
        <div id="mapError" class="field__error"></div>
      </div>
    `;

    const directionsBtn = document.getElementById('directionsBtn');
    const iframe = document.getElementById('mapFrame');
    const mapNote = document.getElementById('mapNote');
    const mapError = document.getElementById('mapError');

    directionsBtn.addEventListener('click', () => {
      mapError.textContent = '';

      if (!navigator.geolocation) {
        mapError.textContent = 'Enable location access to get directions from where you are.';
        return;
      }

      directionsBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          directionsBtn.disabled = false;
          const { latitude: userLat, longitude: userLng } = position.coords;
          iframe.src = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${userLat},${userLng}&destination=${place.latitude},${place.longitude}&mode=driving`;
          mapNote.innerHTML = 'Showing driving directions from your current location. <button class="link-btn" id="resetMapBtn">Reset map</button>';
          mapNote.classList.remove('hidden');
          document.getElementById('resetMapBtn').addEventListener('click', () => {
            iframe.src = placeEmbedUrl;
            mapNote.classList.add('hidden');
            mapNote.innerHTML = '';
          });
        },
        () => {
          directionsBtn.disabled = false;
          mapError.textContent = 'Enable location access to get directions from where you are.';
        }
      );
    });
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
        <span class="rating">${ratingLabel(place)}</span>
        <span>${GT.escapeHtml(place.address)}</span>
      </div>
      <p>${GT.escapeHtml(place.description)}</p>
      <div class="place-detail__tags">
        ${(place.tags || []).map((tag) => `<span class="pill">${GT.escapeHtml(tag)}</span>`).join('')}
      </div>
      <div class="place-detail__actions">
        <button class="btn btn-primary" id="addBtn">Add to trip</button>
        <a class="btn btn-outline" href="/app.html">Back to Browse</a>
      </div>
      <section class="map-section" id="locationSection"></section>
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

    renderLocationSection(place);
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
