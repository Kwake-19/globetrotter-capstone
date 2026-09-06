(() => {
  if (!GT.requireAuthOrRedirect()) return;
  GT.renderHeader({ variant: 'auth', active: 'messages' });
  GT.renderFooter();

  const me = GT.getUser();

  const layout = document.getElementById('messagesLayout');
  const listEl = document.getElementById('conversationList');
  const newBtn = document.getElementById('newMessageBtn');
  const pickerEl = document.getElementById('newMessagePicker');
  const chatEmpty = document.getElementById('chatEmpty');
  const chatActive = document.getElementById('chatActive');
  const chatTitle = document.getElementById('chatTitle');
  const threadEl = document.getElementById('chatThread');
  const composeForm = document.getElementById('chatCompose');
  const composeInput = document.getElementById('chatInput');
  const chatError = document.getElementById('chatError');
  const backBtn = document.getElementById('chatBackBtn');

  // --- state -----------------------------------------------------------------
  let activeConversationId = null;
  let pendingToUser = null; // { id, username } for a not-yet-created thread
  const unread = {};

  // typeof io is provided by /socket.io/socket.io.js
  const socket = io({ auth: { token: GT.getToken() } });

  // --- rendering helpers ---------------------------------------------------
  function showError(msg) {
    chatError.textContent = msg || '';
  }

  function openThreadView() {
    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');
    layout.classList.add('messages-layout--thread-open');
  }

  function closeThreadView() {
    layout.classList.remove('messages-layout--thread-open');
  }

  function messageBubble(msg) {
    const mine = msg.senderId === me.id;
    const cls = `chat-bubble${mine ? ' chat-bubble--mine' : ''}`;

    if (msg.type === 'place' && msg.place) {
      return `
        <a class="${cls} chat-preview-card" href="/place.html?id=${encodeURIComponent(msg.place.id)}">
          ${msg.place.photo ? `<img src="${GT.escapeHtml(msg.place.photo)}" alt="" />` : ''}
          <span><small>Shared a place</small><br>${GT.escapeHtml(msg.place.name)}</span>
        </a>`;
    }
    if (msg.type === 'itinerary' && msg.itinerary) {
      const shareId = msg.shareId || msg.itinerary.shareId;
      return `
        <a class="${cls} chat-preview-card" href="/shared.html?shareId=${encodeURIComponent(shareId)}">
          <span class="chat-preview-card__icon">🧭</span>
          <span><small>Shared an itinerary</small><br>${GT.escapeHtml(msg.itinerary.title)}</span>
        </a>`;
    }
    return `<div class="${cls}">${GT.escapeHtml(msg.text || '')}</div>`;
  }

  function renderThread(messages) {
    threadEl.innerHTML = messages.map(messageBubble).join('');
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function appendMessage(msg) {
    threadEl.insertAdjacentHTML('beforeend', messageBubble(msg));
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function conversationRow(conv) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'conversation-row';
    if (conv.id === activeConversationId) row.classList.add('conversation-row--active');
    row.dataset.id = conv.id;

    const preview = conv.lastMessage ? conv.lastMessage.preview : 'No messages yet';
    row.innerHTML = `
      <span class="conversation-row__name">${GT.escapeHtml(conv.otherUser.name || conv.otherUser.username)}</span>
      <span class="conversation-row__preview">${GT.escapeHtml(preview)}</span>
      ${unread[conv.id] ? '<span class="unread-dot"></span>' : ''}
    `;
    row.addEventListener('click', () => openConversation(conv.id, conv.otherUser));
    return row;
  }

  // --- data ---------------------------------------------------------------
  async function loadConversations() {
    try {
      const data = await GT.api('/conversations');
      listEl.innerHTML = '';
      if (!data.results.length) {
        listEl.innerHTML = '<p class="reviews-empty">No conversations yet.</p>';
        return;
      }
      data.results.forEach((c) => listEl.appendChild(conversationRow(c)));
    } catch (err) {
      listEl.innerHTML = `<p class="form-error">${GT.escapeHtml(err.message)}</p>`;
    }
  }

  async function openConversation(id, otherUser) {
    activeConversationId = id;
    pendingToUser = null;
    delete unread[id];
    chatTitle.textContent = otherUser ? (otherUser.name || `@${otherUser.username}`) : 'Conversation';
    showError('');
    openThreadView();
    threadEl.innerHTML = '<p class="reviews-empty">Loading…</p>';
    try {
      const data = await GT.api(`/conversations/${encodeURIComponent(id)}/messages`);
      renderThread(data.results);
    } catch (err) {
      threadEl.innerHTML = `<p class="form-error">${GT.escapeHtml(err.message)}</p>`;
    }
    loadConversations();
  }

  function openNewThread(user) {
    activeConversationId = null;
    pendingToUser = user;
    chatTitle.textContent = `@${user.username}`;
    threadEl.innerHTML = '';
    showError('');
    openThreadView();
    composeInput.focus();
  }

  async function showRecipientPicker() {
    pickerEl.classList.toggle('hidden');
    if (pickerEl.classList.contains('hidden')) return;
    pickerEl.innerHTML = 'Loading…';
    try {
      const data = await GT.api('/conversations/recipients');
      if (!data.results.length) {
        pickerEl.innerHTML = 'You can only message people you <a href="/people.html">both follow</a>.';
        return;
      }
      pickerEl.innerHTML = '';
      data.results.forEach((u) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-outline btn-sm';
        b.textContent = `@${u.username}`;
        b.addEventListener('click', () => {
          pickerEl.classList.add('hidden');
          openNewThread(u);
        });
        pickerEl.appendChild(b);
      });
    } catch (err) {
      pickerEl.innerHTML = `<span class="form-error">${GT.escapeHtml(err.message)}</span>`;
    }
  }

  // --- events -----------------------------------------------------------
  composeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = composeInput.value.trim();
    if (!text) return;
    showError('');

    const payload = activeConversationId
      ? { conversationId: activeConversationId, type: 'text', text }
      : { toUserId: pendingToUser && pendingToUser.id, type: 'text', text };

    socket.emit('send_message', payload, (ack) => {
      if (ack && ack.ok === false) showError(ack.error || 'Could not send message');
    });
    composeInput.value = '';
  });

  backBtn.addEventListener('click', closeThreadView);
  newBtn.addEventListener('click', showRecipientPicker);

  socket.on('new_message', (msg) => {
    const forActive = activeConversationId && msg.conversationId === activeConversationId;
    const forPending = pendingToUser
      && !activeConversationId
      && (msg.senderId === me.id || msg.senderId === pendingToUser.id);

    if (forPending) {
      activeConversationId = msg.conversationId; // adopt the freshly-created thread
      pendingToUser = null;
    }
    if (forActive || forPending) {
      appendMessage(msg);
    } else {
      unread[msg.conversationId] = (unread[msg.conversationId] || 0) + 1;
    }
    loadConversations();
  });

  socket.on('message_error', ({ error }) => showError(error));
  socket.on('connect_error', (err) => showError(`Realtime connection problem: ${err.message}`));

  // --- init -----------------------------------------------------------
  loadConversations();

  const wantedUserId = new URLSearchParams(window.location.search).get('user');
  if (wantedUserId) {
    GT.api('/conversations/recipients')
      .then((data) => {
        const user = data.results.find((u) => u.id === wantedUserId);
        if (user) openNewThread(user);
        else showErrorInline('You can only message people you both follow.');
      })
      .catch(() => {});
  }

  function showErrorInline(text) {
    chatEmpty.textContent = text;
  }
})();
