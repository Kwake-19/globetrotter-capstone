const express = require('express');
const { readDB } = require('../utils/dataStore');
const { fetchDestinations } = require('../utils/destinationsClient');

const router = express.Router();

// GET /api/shared/:shareId - anyone with the link can view (read-only), no
// authentication. Relocated from the monolith; the only change is that the
// per-stop destination details are fetched from destinations-service
// rather than read off the local db.
router.get('/:shareId', async (req, res, next) => {
  try {
    const db = await readDB();
    const itinerary = db.itineraries.find((it) => it.shareId === req.params.shareId);
    if (!itinerary) {
      return res.status(404).json({ error: 'Shared itinerary not found' });
    }

    let destinations;
    try {
      destinations = await fetchDestinations();
    } catch (err) {
      return res.status(503).json({ error: 'This shared itinerary is temporarily unavailable - please try again shortly' });
    }

    const destinationsById = Object.fromEntries(destinations.map((d) => [d.id, d]));
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
