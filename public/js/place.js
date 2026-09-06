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

  function starDisplay(rating) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  /** All of a place's photos, falling back to the single legacy image field if photos[] is empty. */
  function photosFor(place) {
    if (Array.isArray(place.photos) && place.photos.length > 0) return place.photos;
    const single = place.localImagePath || place.image;
    return single ? [single] : [];
  }

  function renderPhotoGallery(place) {
    const photos = photosFor(place);

    if (photos.length === 0) {
      return '<div class="place-detail__img-fallback">No photo yet</div>';
    }
    if (photos.length === 1) {
      return `<img class="place-detail__img" src="${GT.escapeHtml(photos[0])}" alt="${GT.escapeHtml(place.name)}" loading="lazy"
        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'place-detail__img-fallback',textContent:'Image unavailable'}))" />`;
    }
    return `
      <div class="place-detail__gallery">
        <img class="place-detail__img" id="galleryImg" src="${GT.escapeHtml(photos[0])}" alt="${GT.escapeHtml(place.name)}" loading="lazy" />
        <div class="gallery-controls">
          <button type="button" class="btn btn-outline btn-sm" id="galleryPrev">‹ Prev</button>
          <span class="gallery-counter" id="galleryCounter">1 / ${photos.length}</span>
          <button type="button" class="btn btn-outline btn-sm" id="galleryNext">Next ›</button>
        </div>
      </div>
    `;
  }

  /** Wires the prev/next buttons for a multi-photo gallery. No-op for 0-1 photos (no controls were rendered). */
  function wirePhotoGallery(place) {
    const photos = photosFor(place);
    if (photos.length <= 1) return;

    let index = 0;
    const img = document.getElementById('galleryImg');
    const counter = document.getElementById('galleryCounter');

    function show(newIndex) {
      index = (newIndex + photos.length) % photos.length;
      img.src = photos[index];
      counter.textContent = `${index + 1} / ${photos.length}`;
    }

    document.getElementById('galleryPrev').addEventListener('click', () => show(index - 1));
    document.getElementById('galleryNext').addEventListener('click', () => show(index + 1));
  }

  function reviewCard(review) {
    const date = new Date(review.createdAt).toLocaleDateString();
    return `
      <div class="review-card">
        <div class="review-card__head">
          <span class="review-card__stars">${starDisplay(review.rating)}</span>
          <span class="review-card__author">${GT.escapeHtml(review.userName)}</span>
          <span class="review-card__date">${date}</span>
        </div>
        <p class="review-card__text">${GT.escapeHtml(review.text)}</p>
      </div>
    `;
  }

  /** The review submit/edit form. `existing` is null for a fresh review, or the user's own review to edit. */
  function renderReviewForm(place, existing, onSaved) {
    const wrap = document.getElementById('reviewFormWrap');
    wrap.innerHTML = `
      <form id="reviewForm" class="review-form">
        <div class="field">
          <label for="reviewRating">Your rating</label>
          <select id="reviewRating">
            ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${existing && existing.rating === n ? ' selected' : ''}>${starDisplay(n)} (${n})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="reviewText">Your review</label>
          <textarea id="reviewText" rows="3" maxlength="500">${existing ? GT.escapeHtml(existing.text) : ''}</textarea>
        </div>
        <div id="reviewFormError" class="field__error"></div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="btn btn-primary btn-sm">${existing ? 'Save changes' : 'Submit review'}</button>
          ${existing ? '<button type="button" class="btn btn-ghost btn-sm" id="cancelEditBtn">Cancel</button>' : ''}
        </div>
      </form>
    `;

    if (existing) {
      document.getElementById('cancelEditBtn').addEventListener('click', onSaved);
    }

    document.getElementById('reviewForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('reviewFormError');
      errorEl.textContent = '';

      const rating = Number(document.getElementById('reviewRating').value);
      const text = document.getElementById('reviewText').value.trim();
      if (!text) {
        errorEl.textContent = 'Please write a few words.';
        return;
      }

      try {
        await GT.api(`/destinations/${encodeURIComponent(place.id)}/reviews`, {
          method: 'POST',
          body: JSON.stringify({ rating, text })
        });
        onSaved();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  async function renderReviewsSection(place) {
    const section = document.getElementById('reviewsSection');

    let reviews = [];
    try {
      const data = await GT.api(`/destinations/${encodeURIComponent(place.id)}/reviews`);
      reviews = data.results;
    } catch (err) {
      // Leave reviews empty - still show the section shell and the form.
    }

    const currentUser = GT.getUser();
    const myReview = currentUser ? reviews.find((r) => r.userId === currentUser.id) : null;
    // The user's own review gets its own callout (with Edit/Delete) below,
    // so it isn't shown twice in the plain list.
    const otherReviews = myReview ? reviews.filter((r) => r.id !== myReview.id) : reviews;

    section.innerHTML = `
      <h2>Reviews</h2>
      <div id="reviewsList" class="reviews-list">
        ${otherReviews.length === 0 && !myReview ? '<p class="reviews-empty">No reviews yet — be the first!</p>' : otherReviews.map(reviewCard).join('')}
      </div>
      <div id="reviewFormWrap"></div>
    `;

    function showMyReviewCallout() {
      renderReviewsSection(place);
    }

    if (!GT.getToken()) {
      document.getElementById('reviewFormWrap').innerHTML = '<p class="reviews-login-prompt"><a href="/login.html">Log in</a> to leave a review.</p>';
      return;
    }

    if (myReview) {
      const wrap = document.getElementById('reviewFormWrap');
      wrap.innerHTML = `
        <div class="review-card review-card--mine">
          <div class="review-card__head">
            <span class="review-card__stars">${starDisplay(myReview.rating)}</span>
            <span class="review-card__author">Your review</span>
          </div>
          <p class="review-card__text">${GT.escapeHtml(myReview.text)}</p>
          <div style="display:flex; gap:10px;">
            <button type="button" class="btn btn-outline btn-sm" id="editReviewBtn">Edit</button>
            <button type="button" class="link-btn" id="deleteReviewBtn">Delete</button>
          </div>
        </div>
      `;
      document.getElementById('editReviewBtn').addEventListener('click', () => {
        renderReviewForm(place, myReview, showMyReviewCallout);
      });
      document.getElementById('deleteReviewBtn').addEventListener('click', async () => {
        if (!window.confirm('Delete your review?')) return;
        try {
          await GT.api(`/destinations/${encodeURIComponent(place.id)}/reviews/${encodeURIComponent(myReview.id)}`, {
            method: 'DELETE'
          });
          renderReviewsSection(place);
        } catch (err) {
          window.alert(err.message);
        }
      });
      return;
    }

    renderReviewForm(place, null, showMyReviewCallout);
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

    directionsBtn.addEventListener('click', async () => {
      mapError.textContent = '';
      directionsBtn.disabled = true;

      try {
        const { latitude: userLat, longitude: userLng } = await GT.getCurrentPosition();
        iframe.src = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${userLat},${userLng}&destination=${place.latitude},${place.longitude}&mode=driving`;
        mapNote.innerHTML = 'Showing driving directions from your current location. <button class="link-btn" id="resetMapBtn">Reset map</button>';
        mapNote.classList.remove('hidden');
        document.getElementById('resetMapBtn').addEventListener('click', () => {
          iframe.src = placeEmbedUrl;
          mapNote.classList.add('hidden');
          mapNote.innerHTML = '';
        });
      } catch (err) {
        mapError.textContent = 'Enable location access to get directions from where you are.';
      } finally {
        directionsBtn.disabled = false;
      }
    });
  }

  function render(place) {
    const detailLines = [
      place.openingHours ? `<p class="place-detail__meta-line"><strong>Hours:</strong> ${GT.escapeHtml(place.openingHours)}</p>` : '',
      place.phone ? `<p class="place-detail__meta-line"><strong>Phone:</strong> ${GT.escapeHtml(place.phone)}</p>` : '',
      place.website ? `<p class="place-detail__meta-line"><strong>Website:</strong> <a href="${GT.escapeHtml(place.website)}" target="_blank" rel="noopener noreferrer">${GT.escapeHtml(place.website)}</a></p>` : ''
    ].join('');

    const amenitiesBlock = (place.amenities && place.amenities.length > 0)
      ? `<div class="place-detail__amenities">
          <h3>Amenities</h3>
          <ul>${place.amenities.map((a) => `<li>${GT.escapeHtml(a)}</li>`).join('')}</ul>
        </div>`
      : '';

    content.innerHTML = `
      ${renderPhotoGallery(place)}
      <div class="place-detail__head">
        <h1>${GT.escapeHtml(place.name)}</h1>
        <span class="pill">${GT.escapeHtml(GT.categoryLabel(place.category))}</span>
      </div>
      <div class="place-detail__meta-row">
        <span>${GT.escapeHtml(place.neighborhood)}</span>
        <span class="rating">${GT.escapeHtml(GT.ratingSummary(place))}</span>
        <span>${GT.escapeHtml(place.address)}</span>
      </div>
      <p>${GT.escapeHtml(place.description)}</p>
      ${place.descriptionSource === 'ai-generated' ? '<p class="place-detail__desc-note">Description generated automatically</p>' : ''}
      <div class="place-detail__tags">
        ${(place.tags || []).map((tag) => `<span class="pill">${GT.escapeHtml(tag)}</span>`).join('')}
      </div>
      ${detailLines}
      ${amenitiesBlock}
      <div class="place-detail__actions">
        <button class="btn btn-primary" id="addBtn">Add to trip</button>
        <a class="btn btn-outline" href="/app.html">Back to Browse</a>
      </div>
      <section class="map-section" id="locationSection"></section>
      <section class="reviews-section" id="reviewsSection"></section>
    `;

    wirePhotoGallery(place);

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
    renderReviewsSection(place);
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
