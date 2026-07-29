const express = require('express');
const { readDB } = require('../utils/dataStore');

const router = express.Router();

// GET /api/shared/:shareId - anyone with the link can view (read-only),
// no authentication required. This is how a user shares an itinerary
// with friends and family per the business requirements.
router.get('/:shareId', async (req, res, next) => {
  try {
    const db = await readDB();
    const itinerary = db.itineraries.find((it) => it.shareId === req.params.shareId);
    if (!itinerary) {
      return res.status(404).json({ error: 'Shared itinerary not found' });
    }

    const destinationsById = Object.fromEntries(db.destinations.map((d) => [d.id, d]));
    const items = itinerary.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({ ...item, destination: destinationsById[item.destinationId] || null }));

    return res.json({ title: itinerary.title, items });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
