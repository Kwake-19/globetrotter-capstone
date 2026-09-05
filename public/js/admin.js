(() => {
  if (!GT.requireAuthOrRedirect()) return;

  const root = document.getElementById('adminRoot');
  let destinations = [];

  function renderShell() {
    root.innerHTML = `
      <div class="page-head">
        <h1>Manage destinations</h1>
        <p>Add, edit, or remove the places shown across the app.</p>
      </div>
      <div class="admin-toolbar">
        <a class="btn btn-primary" href="/admin-edit.html">+ Add new place</a>
      </div>
      <div id="adminError" class="form-error hidden"></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Rating</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="adminTableBody"></tbody>
        </table>
      </div>
      <div id="adminEmptyState" class="empty-state hidden">No destinations yet - add the first one.</div>
    `;

    document.getElementById('adminRoot').addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-delete]');
      if (!deleteBtn) return;

      const id = deleteBtn.dataset.delete;
      const destination = destinations.find((d) => d.id === id);
      const confirmed = window.confirm(`Delete "${destination ? destination.name : id}"? This cannot be undone.`);
      if (!confirmed) return;

      deleteBtn.disabled = true;
      try {
        await GT.api(`/admin/destinations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadAndRenderTable();
      } catch (err) {
        document.getElementById('adminError').textContent = err.message;
        document.getElementById('adminError').classList.remove('hidden');
        deleteBtn.disabled = false;
      }
    });
  }

  function renderTable() {
    const tbody = document.getElementById('adminTableBody');
    tbody.innerHTML = '';
    document.getElementById('adminEmptyState').classList.toggle('hidden', destinations.length > 0);

    destinations.forEach((place) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${GT.escapeHtml(place.name)}</td>
        <td>${GT.escapeHtml(GT.categoryLabel(place.category))}</td>
        <td>${typeof place.rating === 'number' ? place.rating.toFixed(1) : '—'}</td>
        <td class="admin-table__actions">
          <a class="btn btn-outline btn-sm" href="/admin-edit.html?id=${encodeURIComponent(place.id)}">Edit</a>
          <button type="button" class="btn btn-danger btn-sm" data-delete="${place.id}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function loadAndRenderTable() {
    const data = await GT.api('/admin/destinations');
    destinations = data.results;
    renderTable();
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

    renderShell();
    await loadAndRenderTable();
  }

  init();
})();
