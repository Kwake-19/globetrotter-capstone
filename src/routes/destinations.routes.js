const express = require('express');
const { readDB } = require('../utils/dataStore');
const { optionalAuth } = require('../middleware/auth');
const { parseSearchQuery } = require('../services/aiSearch');
const { computeCategoryCounts, rankByCategoryAffinity } = require('../utils/personalization');

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

// Plain-text search used by GET /?q= - also reused as the fallback for
// GET /smart-search when the AI parse fails/times out/is rate-limited, so
// there's exactly one place this matching logic lives.
function filterByPlainText(destinations, q) {
  const term = q.trim().toLowerCase();
  return destinations.filter((d) => (
    d.name.toLowerCase().includes(term) ||
    d.description.toLowerCase().includes(term) ||
    d.tags.some((tag) => tag.toLowerCase().includes(term))
  ));
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
      results = filterByPlainText(results, q);
    }

    return res.json({ count: results.length, results: results.map(toPublicDestination) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/destinations/smart-search?q=<free text>
// Uses OpenRouter (if configured) to turn the query into { category,
// neighborhood, keywords, minRating } filters, then matches that against
// the real destinations in data/db.json - the AI only ever interprets
// intent, it never invents results. If the AI call fails, times out, or is
// rate-limited, this degrades to the exact same plain-text search as
// GET /api/destinations?q=, so the endpoint never fails outright just
// because the AI provider is unavailable.
router.get('/smart-search', optionalAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const db = await readDB();

    let aiParsed = true;
    let filters = null;
    let results;

    try {
      filters = await parseSearchQuery(q, VALID_CATEGORIES);

      results = db.destinations.filter((d) => {
        if (filters.category && d.category !== filters.category) return false;

        if (filters.neighborhood
          && !d.neighborhood.toLowerCase().includes(filters.neighborhood.toLowerCase())) {
          return false;
        }

        if (filters.minRating != null && !(d.rating >= filters.minRating)) return false;

        if (filters.keywords.length > 0) {
          const haystack = [d.name, d.description, ...(d.tags || [])].join(' ').toLowerCase();
          if (!filters.keywords.every((keyword) => haystack.includes(keyword))) return false;
        }

        return true;
      });
    } catch (err) {
      // AI_UNAVAILABLE (missing key, network/timeout error, both models
      // failed, or the model's response wasn't valid JSON) - fall back to
      // plain keyword search rather than failing the request.
      aiParsed = false;
      filters = null;
      results = filterByPlainText(db.destinations, q);
    }

    // Re-rank using the same "categories from the user's past itineraries"
    // signal /api/recommendations uses. Guests get an empty categoryCounts,
    // which makes this reduce to plain rating-descending order.
    const { categoryCounts } = req.user ? computeCategoryCounts(db, req.user.id) : { categoryCounts: {} };
    results = rankByCategoryAffinity(results, categoryCounts);

    return res.json({
      aiParsed,
      filters,
      count: results.length,
      results: results.map(toPublicDestination)
    });
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
