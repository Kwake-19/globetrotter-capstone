const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toDestinationSummary(destination) {
  return { id: destination.id, name: destination.name, country: destination.country };
}

// Public shared view - must be registered before the authenticated :id-based routes
// so "/shared" isn't captured as an :id param, and so it stays reachable without a token.
router.get('/itineraries/shared/:shareToken', (req, res) => {
  const itinerary = db.getItineraryByShareToken(req.params.shareToken);
  if (!itinerary) {
    return res.status(404).json({ error: 'shared itinerary not found' });
  }
  return res.status(200).json(itinerary);
});

router.post('/itineraries', requireAuth, (req, res) => {
  const { title, destinationIds, startDate, endDate, notes } = req.body || {};
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';

  if (!trimmedTitle) {
    return res.status(400).json({ error: 'title is required' });
  }

  if (!Array.isArray(destinationIds) || destinationIds.length < 1 || destinationIds.length > 2) {
    return res.status(400).json({ error: 'destinationIds must be an array of 1-2 destination ids' });
  }

  const destinations = [];
  for (const id of destinationIds) {
    const destination = db.getDestinationById(id);
    if (!destination) {
      return res.status(400).json({ error: `unknown destination id: ${id}` });
    }
    destinations.push(toDestinationSummary(destination));
  }

  const itinerary = {
    id: db.uuidv4(),
    username: req.user,
    title: trimmedTitle,
    destinations,
    startDate: startDate || '',
    endDate: endDate || '',
    notes: notes || '',
    createdAt: new Date().toISOString(),
    shareToken: null,
  };
  db.saveItinerary(itinerary);

  return res.status(201).json(itinerary);
});

router.get('/itineraries', requireAuth, (req, res) => {
  return res.status(200).json(db.getItinerariesForUser(req.user));
});

router.post('/itineraries/:id/share', requireAuth, (req, res) => {
  const itinerary = db.getItineraryById(req.params.id);
  if (!itinerary) {
    return res.status(404).json({ error: 'itinerary not found' });
  }
  if (itinerary.username !== req.user) {
    return res.status(403).json({ error: 'you do not own this itinerary' });
  }

  const shareToken = itinerary.shareToken || db.uuidv4();
  const updated = db.updateItinerary(itinerary.id, { shareToken });

  return res.status(200).json({
    shareToken: updated.shareToken,
    shareUrl: `/?share=${updated.shareToken}`,
  });
});

module.exports = router;
