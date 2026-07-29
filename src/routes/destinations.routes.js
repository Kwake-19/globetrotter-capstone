const express = require('express');
const { readDB } = require('../utils/dataStore');

const router = express.Router();

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'petrol_station', 'hotel'];

// scripts/enrich-places.js fills these in later; default them to null so API
// consumers always see the fields rather than them being missing entirely.
function toPublicDestination(destination) {
  return {
    ...destination,
    placeId: destination.placeId ?? null,
    localImagePath: destination.localImagePath ?? null
  };
}

// GET /api/destinations?category=restaurant&q=bastos&neighborhood=Bastos
router.get('/', async (req, res, next) => {
  try {
    const { category, q, neighborhood } = req.query;

    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `category must be one of: ${VALID_CATEGORIES.join(', ')}`
      });
    }

    const db = await readDB();
    let results = db.destinations;

    if (category) {
      results = results.filter((d) => d.category === category);
    }

    if (neighborhood) {
      const term = neighborhood.trim().toLowerCase();
      results = results.filter((d) => d.neighborhood.toLowerCase().includes(term));
    }

    if (q) {
      const term = q.trim().toLowerCase();
      results = results.filter((d) => {
        return (
          d.name.toLowerCase().includes(term) ||
          d.description.toLowerCase().includes(term) ||
          d.tags.some((tag) => tag.toLowerCase().includes(term))
        );
      });
    }

    return res.json({ count: results.length, results: results.map(toPublicDestination) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/destinations/categories - small helper for the UI's filter chips
router.get('/categories', (req, res) => {
  res.json({
    categories: [
      { id: 'restaurant', label: 'Restaurants' },
      { id: 'ice_cream', label: 'Ice Cream & Desserts' },
      { id: 'mall', label: 'Malls & Shopping' },
      { id: 'fun_place', label: 'Fun & Attractions' },
      { id: 'hotel', label: 'Hotels' },
      { id: 'petrol_station', label: 'Petrol Stations' }
    ]
  });
});

// GET /api/destinations/:id
router.get('/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const destination = db.destinations.find((d) => d.id === req.params.id);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found' });
    }
    return res.json(toPublicDestination(destination));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
