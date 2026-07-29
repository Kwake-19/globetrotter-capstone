const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function validateItems(items, destinations) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'items must be a non-empty array of { destinationId, notes? }';
  }
  const validIds = new Set(destinations.map((d) => d.id));
  for (const item of items) {
    if (!item || !validIds.has(item.destinationId)) {
      return `Unknown destinationId: ${item && item.destinationId}`;
    }
  }
  return null;
}

// All routes below require a logged-in user.
router.use(requireAuth);

// POST /api/itineraries
router.post('/', async (req, res, next) => {
  try {
    const { title, items } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const db = await readDB();
    const validationError = validateItems(items, db.destinations);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const itinerary = {
      id: uuidv4(),
      userId: req.user.id,
      title: title.trim(),
      items: items.map((item, index) => ({
        destinationId: item.destinationId,
        notes: item.notes || '',
        order: index
      })),
      shareId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.itineraries.push(itinerary);
    await writeDB(db);

    return res.status(201).json(itinerary);
  } catch (err) {
    return next(err);
  }
});

// GET /api/itineraries - only the current user's itineraries
router.get('/', async (req, res, next) => {
  try {
    const db = await readDB();
    const mine = db.itineraries.filter((it) => it.userId === req.user.id);
    return res.json({ count: mine.length, results: mine });
  } catch (err) {
    return next(err);
  }
});

// GET /api/itineraries/:id
router.get('/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const itinerary = db.itineraries.find((it) => it.id === req.params.id);
    if (!itinerary || itinerary.userId !== req.user.id) {
      return res.status(404).json({ error: 'Itinerary not found' });
    }
    return res.json(itinerary);
  } catch (err) {
    return next(err);
  }
});

// PUT /api/itineraries/:id
router.put('/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const itinerary = db.itineraries.find((it) => it.id === req.params.id);
    if (!itinerary || itinerary.userId !== req.user.id) {
      return res.status(404).json({ error: 'Itinerary not found' });
    }

    const { title, items } = req.body || {};
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'title cannot be empty' });
      itinerary.title = title.trim();
    }
    if (items !== undefined) {
      const validationError = validateItems(items, db.destinations);
      if (validationError) return res.status(400).json({ error: validationError });
      itinerary.items = items.map((item, index) => ({
        destinationId: item.destinationId,
        notes: item.notes || '',
        order: index
      }));
    }
    itinerary.updatedAt = new Date().toISOString();

    await writeDB(db);
    return res.json(itinerary);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/itineraries/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const index = db.itineraries.findIndex((it) => it.id === req.params.id);
    if (index === -1 || db.itineraries[index].userId !== req.user.id) {
      return res.status(404).json({ error: 'Itinerary not found' });
    }
    db.itineraries.splice(index, 1);
    await writeDB(db);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// POST /api/itineraries/:id/share - generates (or returns) a public share link
router.post('/:id/share', async (req, res, next) => {
  try {
    const db = await readDB();
    const itinerary = db.itineraries.find((it) => it.id === req.params.id);
    if (!itinerary || itinerary.userId !== req.user.id) {
      return res.status(404).json({ error: 'Itinerary not found' });
    }
    if (!itinerary.shareId) {
      itinerary.shareId = uuidv4();
      await writeDB(db);
    }
    return res.json({ shareId: itinerary.shareId, shareUrl: `/shared.html?shareId=${itinerary.shareId}` });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
