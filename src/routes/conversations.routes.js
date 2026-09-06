const express = require('express');
const { readDB } = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');
const { ensureSocialArrays, publicUser, isMutual, followingIds } = require('../utils/social');
const { sendMessage } = require('../utils/messaging');
const { emitNewMessage } = require('../realtime');

const router = express.Router();

const PREVIEW_LENGTH = 80;

router.use(requireAuth);

function lastMessagePreview(message) {
  if (!message) return null;
  let preview;
  if (message.type === 'text') {
    preview = message.text.length > PREVIEW_LENGTH
      ? `${message.text.slice(0, PREVIEW_LENGTH)}…`
      : message.text;
  } else if (message.type === 'place') {
    preview = 'Shared a place';
  } else {
    preview = 'Shared an itinerary';
  }
  return { type: message.type, preview, createdAt: message.createdAt };
}

// GET /api/conversations - the current user's threads, most-recent activity first.
router.get('/', async (req, res, next) => {
  try {
    const db = await readDB();
    ensureSocialArrays(db);

    const usersById = Object.fromEntries(db.users.map((u) => [u.id, u]));
    const mine = db.conversations.filter((c) => c.participantIds.includes(req.user.id));

    const results = mine.map((c) => {
      const otherId = c.participantIds.find((id) => id !== req.user.id);
      const messages = db.messages.filter((m) => m.conversationId === c.id);
      const last = messages[messages.length - 1] || null;
      return {
        id: c.id,
        otherUser: publicUser(usersById[otherId]),
        lastMessage: lastMessagePreview(last)
      };
    });

    results.sort((a, b) => {
      const at = a.lastMessage ? new Date(a.lastMessage.createdAt) : 0;
      const bt = b.lastMessage ? new Date(b.lastMessage.createdAt) : 0;
      return bt - at;
    });

    return res.json({ count: results.length, results });
  } catch (err) {
    return next(err);
  }
});

// GET /api/conversations/recipients - people you can start a chat with
// (mutual follows). Powers the "Share with..." pickers and the new-message picker.
router.get('/recipients', async (req, res, next) => {
  try {
    const db = await readDB();
    ensureSocialArrays(db);

    const usersById = Object.fromEntries(db.users.map((u) => [u.id, u]));
    const results = followingIds(db, req.user.id)
      .filter((id) => isMutual(db, req.user.id, id))
      .map((id) => publicUser(usersById[id]))
      .filter(Boolean);

    return res.json({ count: results.length, results });
  } catch (err) {
    return next(err);
  }
});

// GET /api/conversations/:id/messages - full history, oldest first. Participant only.
router.get('/:id/messages', async (req, res, next) => {
  try {
    const db = await readDB();
    ensureSocialArrays(db);

    const conversation = db.conversations.find((c) => c.id === req.params.id);
    // 404 (not 403) for a non-participant so we don't leak that the thread exists.
    if (!conversation || !conversation.participantIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const destinationsById = Object.fromEntries(db.destinations.map((d) => [d.id, d]));
    const itinerariesById = Object.fromEntries(db.itineraries.map((it) => [it.id, it]));

    const messages = db.messages
      .filter((m) => m.conversationId === conversation.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((m) => {
        if (m.type === 'place') {
          const d = destinationsById[m.destinationId];
          return {
            ...m,
            place: d
              ? {
                id: d.id,
                name: d.name,
                photo: d.localImagePath || d.image || (Array.isArray(d.photos) ? d.photos[0] : null) || null
              }
              : null
          };
        }
        if (m.type === 'itinerary') {
          const it = itinerariesById[m.itineraryId];
          return {
            ...m,
            itinerary: it ? { id: it.id, title: it.title, shareId: m.shareId || it.shareId } : null
          };
        }
        return m;
      });

    return res.json({ count: messages.length, results: messages });
  } catch (err) {
    return next(err);
  }
});

// POST /api/conversations/messages - REST send (fallback + used by the
// "Share with..." buttons on pages that hold no socket). Same validation and
// persistence as the socket path, then the same targeted fan-out.
router.post('/messages', async (req, res, next) => {
  try {
    const { conversationId, toUserId, type, text, destinationId, itineraryId } = req.body || {};
    const { message, participantIds } = await sendMessage({
      senderId: req.user.id, conversationId, toUserId, type, text, destinationId, itineraryId
    });

    emitNewMessage(req.app.get('io'), participantIds, message);

    return res.status(201).json({ message, conversationId: message.conversationId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
