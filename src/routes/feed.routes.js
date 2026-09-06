const express = require('express');
const { readDB } = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');
const { ensureSocialArrays, publicUser, followingIds } = require('../utils/social');

const router = express.Router();

const FEED_LIMIT = 50;

router.use(requireAuth);

function photoOf(destination) {
  return destination.localImagePath
    || destination.image
    || (Array.isArray(destination.photos) ? destination.photos[0] : null)
    || null;
}

function miniDestination(destination) {
  return {
    id: destination.id,
    name: destination.name,
    category: destination.category,
    neighborhood: destination.neighborhood,
    photo: photoOf(destination)
  };
}

// GET /api/feed - reverse-chronological activity from the people you follow:
// their reviews, and their itineraries that they've shared (have a shareId).
router.get('/', async (req, res, next) => {
  try {
    const db = await readDB();
    ensureSocialArrays(db);

    const following = new Set(followingIds(db, req.user.id));
    const usersById = Object.fromEntries(db.users.map((u) => [u.id, u]));
    const destinationsById = Object.fromEntries(db.destinations.map((d) => [d.id, d]));

    const items = [];

    (db.reviews || []).forEach((r) => {
      if (!following.has(r.userId)) return;
      const destination = destinationsById[r.destinationId];
      if (!destination) return;
      items.push({
        type: 'review',
        createdAt: r.createdAt,
        actor: publicUser(usersById[r.userId]),
        destination: miniDestination(destination),
        rating: r.rating,
        text: r.text
      });
    });

    (db.itineraries || []).forEach((it) => {
      if (!following.has(it.userId) || !it.shareId) return;
      items.push({
        type: 'itinerary',
        createdAt: it.updatedAt || it.createdAt,
        actor: publicUser(usersById[it.userId]),
        itinerary: {
          id: it.id,
          title: it.title,
          shareId: it.shareId,
          stopCount: it.items.length
        }
      });
    });

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ count: Math.min(items.length, FEED_LIMIT), results: items.slice(0, FEED_LIMIT) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
