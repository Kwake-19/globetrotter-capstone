const express = require('express');
const { readDB } = require('../utils/dataStore');
const { fetchAllDestinations } = require('../utils/recommendationClient');

const router = express.Router();

// GET /api/shared/:shareId - anyone with the link can view (read-only),
// no authentication required. Enriching each stop with its destination
// details is a synchronous REST call to the Recommendation Service, since
// this service no longer owns destination data.
router.get('/:shareId', async (req, res, next) => {
  try {
    const db = await readDB();
    const itinerary = db.itineraries.find((it) => it.shareId === req.params.shareId);
    if (!itinerary) {
      return res.status(404).json({ error: 'Shared itinerary not found' });
    }

    const destinations = await fetchAllDestinations();
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
