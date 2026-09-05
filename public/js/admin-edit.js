(() => {
  if (!GT.requireAuthOrRedirect()) return;

  const root = document.getElementById('adminRoot');
  const editId = new URLSearchParams(window.location.search).get('id');

  /** Splits a comma- or newline-separated field into a clean list of strings. */
  function splitList(value) {
    return value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
  }

  function renderForm(existing) {
    const isEdit = !!existing;

    root.innerHTML = `
      <div class="page-head">
        <h1>${isEdit ? 'Edit destination' : 'Add new place'}</h1>
        <p><a href="/admin.html">&larr; Back to all destinations</a></p>
      </div>
      <div id="formError" class="form-error hidden"></div>
      <form id="destinationForm" class="auth-form" novalidate>
        <div class="field">
          <label for="name">Name</label>
          <input type="text" id="name" required />
        </div>
        <div class="field">
          <label for="category">Category</label>
          <select id="category" required>
            ${GT.CATEGORIES.map((c) => `<option value="${c.id}">${GT.escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="neighborhood">Neighborhood</label>
          <input type="text" id="neighborhood" required />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="latitude">Latitude</label>
            <input type="number" step="any" id="latitude" required />
          </div>
          <div class="field">
            <label for="longitude">Longitude</label>
            <input type="number" step="any" id="longitude" required />
          </div>
        </div>
        <div class="field">
          <label for="address">Address</label>
          <input type="text" id="address" />
        </div>
        <div class="field">
          <label for="description">Description</label>
          <textarea id="description" rows="3"></textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="rating">Rating <span class="field__hint">(0-5)</span></label>
            <input type="number" step="0.1" min="0" max="5" id="rating" />
          </div>
          <div class="field">
            <label for="priceLevel">Price level <span class="field__hint">(1-4)</span></label>
            <input type="number" step="1" min="1" max="4" id="priceLevel" />
          </div>
        </div>
        <div class="field">
          <label for="tags">Tags <span class="field__hint">(comma-separated - vibe/category words used by search)</span></label>
          <input type="text" id="tags" placeholder="e.g. pizza, rooftop, family-friendly" />
        </div>
        <div class="field">
          <label for="amenities">Amenities <span class="field__hint">(comma-separated - concrete facts, not vibes)</span></label>
          <input type="text" id="amenities" placeholder="e.g. Free WiFi, Wheelchair accessible, Free parking" />
        </div>
        <div class="field">
          <label for="phone">Phone</label>
          <input type="tel" id="phone" />
        </div>
        <div class="field">
          <label for="website">Website</label>
          <input type="url" id="website" placeholder="https://..." />
        </div>
        <div class="field">
          <label for="openingHours">Opening hours</label>
          <input type="text" id="openingHours" placeholder="e.g. Mon-Sat 8am-10pm" />
        </div>
        <div class="field">
          <label for="photos">Photos <span class="field__hint">(one image path or URL per line - the first becomes the main photo)</span></label>
          <textarea id="photos" rows="3" placeholder="/images/places/my-place-1.jpg"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" id="submitBtn">${isEdit ? 'Save changes' : 'Create place'}</button>
      </form>
    `;

    const fields = {
      name: document.getElementById('name'),
      category: document.getElementById('category'),
      neighborhood: document.getElementById('neighborhood'),
      latitude: document.getElementById('latitude'),
      longitude: document.getElementById('longitude'),
      address: document.getElementById('address'),
      description: document.getElementById('description'),
      rating: document.getElementById('rating'),
      priceLevel: document.getElementById('priceLevel'),
      tags: document.getElementById('tags'),
      amenities: document.getElementById('amenities'),
      phone: document.getElementById('phone'),
      website: document.getElementById('website'),
      openingHours: document.getElementById('openingHours'),
      photos: document.getElementById('photos')
    };

    if (existing) {
      fields.name.value = existing.name || '';
      fields.category.value = existing.category || '';
      fields.neighborhood.value = existing.neighborhood || '';
      fields.latitude.value = existing.latitude ?? '';
      fields.longitude.value = existing.longitude ?? '';
      fields.address.value = existing.address || '';
      fields.description.value = existing.description || '';
      fields.rating.value = existing.rating ?? '';
      fields.priceLevel.value = existing.priceLevel ?? '';
      fields.tags.value = (existing.tags || []).join(', ');
      fields.amenities.value = (existing.amenities || []).join(', ');
      fields.phone.value = existing.phone || '';
      fields.website.value = existing.website || '';
      fields.openingHours.value = existing.openingHours || '';
      fields.photos.value = (existing.photos || []).join('\n');
    }

    document.getElementById('destinationForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formError = document.getElementById('formError');
      formError.classList.add('hidden');

      const payload = {
        name: fields.name.value.trim(),
        category: fields.category.value,
        neighborhood: fields.neighborhood.value.trim(),
        latitude: fields.latitude.value === '' ? null : Number(fields.latitude.value),
        longitude: fields.longitude.value === '' ? null : Number(fields.longitude.value),
        address: fields.address.value.trim(),
        description: fields.description.value.trim(),
        rating: fields.rating.value === '' ? null : Number(fields.rating.value),
        priceLevel: fields.priceLevel.value === '' ? null : Number(fields.priceLevel.value),
        tags: splitList(fields.tags.value),
        amenities: splitList(fields.amenities.value),
        phone: fields.phone.value.trim(),
        website: fields.website.value.trim(),
        openingHours: fields.openingHours.value.trim(),
        photos: splitList(fields.photos.value)
      };

      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      try {
        if (isEdit) {
          await GT.api(`/admin/destinations/${encodeURIComponent(existing.id)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
        } else {
          await GT.api('/admin/destinations', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }
        window.location.href = '/admin.html';
      } catch (err) {
        formError.textContent = err.message;
        formError.classList.remove('hidden');
        submitBtn.disabled = false;
      }
    });
  }

  async function init() {
    let user;
    try {
      user = await GT.api('/profile');
    } catch (err) {
      window.location.replace('/login.html');
      return;
    }
    if (!user.isAdmin) {
      window.location.replace('/app.html');
      return;
    }

    GT.renderHeader({ variant: 'auth', active: 'admin' });
    GT.renderFooter();

    if (!editId) {
      renderForm(null);
      return;
    }

    try {
      const all = await GT.api('/admin/destinations');
      const existing = all.results.find((d) => d.id === editId);
      if (!existing) {
        root.innerHTML = '<div class="empty-state">Destination not found. <a href="/admin.html">Back to all destinations</a>.</div>';
        return;
      }
      renderForm(existing);
    } catch (err) {
      root.innerHTML = `<div class="form-error">${GT.escapeHtml(err.message)}</div>`;
    }
  }

  init();
})();
