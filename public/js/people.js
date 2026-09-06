(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'people' });
  GT.renderFooter();

  const me = GT.getUser();

  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const followingList = document.getElementById('followingList');
  const followersList = document.getElementById('followersList');

  /** One person row: name, @username, Follow/Following toggle, Message (if mutual). */
  function personRow(person) {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.dataset.userId = person.id;

    const mutual = person.youFollow && person.followsYou;
    row.innerHTML = `
      <div class="person-row__id">
        <span class="person-row__name">${GT.escapeHtml(person.name || person.username)}</span>
        <span class="person-row__handle">@${GT.escapeHtml(person.username)}</span>
        ${person.followsYou ? '<span class="pill">Follows you</span>' : ''}
      </div>
      <div class="person-row__actions">
        ${mutual ? `<a class="btn btn-outline btn-sm" href="/messages.html?user=${encodeURIComponent(person.id)}">Message</a>` : ''}
        <button class="btn btn-sm follow-btn${person.youFollow ? ' follow-btn--following' : ' btn-primary'}"
          data-following="${person.youFollow ? '1' : '0'}">
          ${person.youFollow ? 'Following' : 'Follow'}
        </button>
      </div>
    `;

    row.querySelector('.follow-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const following = btn.dataset.following === '1';
      btn.disabled = true;
      try {
        if (following) {
          await GT.api(`/users/${encodeURIComponent(person.id)}/follow`, { method: 'DELETE' });
        } else {
          await GT.api(`/users/${encodeURIComponent(person.id)}/follow`, { method: 'POST' });
        }
        // Simplest correct refresh: reload the two owned lists and re-run the search.
        loadLists();
        if (searchInput.value.trim()) runSearch();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    return row;
  }

  function renderInto(container, people, emptyText) {
    container.innerHTML = '';
    if (!people.length) {
      container.innerHTML = `<p class="reviews-empty">${emptyText}</p>`;
      return;
    }
    people.forEach((p) => container.appendChild(personRow(p)));
  }

  async function runSearch() {
    const q = searchInput.value.trim();
    if (!q) {
      searchResults.innerHTML = '';
      return;
    }
    try {
      const data = await GT.api(`/users?q=${encodeURIComponent(q)}`);
      renderInto(searchResults, data.results, 'No one matched that search.');
    } catch (err) {
      searchResults.innerHTML = `<p class="form-error">${GT.escapeHtml(err.message)}</p>`;
    }
  }

  async function loadLists() {
    try {
      const [following, followers] = await Promise.all([
        GT.api(`/users/${encodeURIComponent(me.id)}/following`),
        GT.api(`/users/${encodeURIComponent(me.id)}/followers`)
      ]);
      renderInto(followingList, following.results, "You aren't following anyone yet.");
      renderInto(followersList, followers.results, "You don't have any followers yet.");
    } catch (err) {
      followingList.innerHTML = `<p class="form-error">${GT.escapeHtml(err.message)}</p>`;
    }
  }

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });

  loadLists();
})();
