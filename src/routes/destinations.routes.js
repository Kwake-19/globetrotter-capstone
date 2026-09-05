const express = require('express');
const { readDB } = require('../utils/dataStore');
const { parseSearchQuery } = require('../services/aiSearch');
const { matchSignals } = require('../services/searchSynonyms');
const { rankDestinations, scoreDestination } = require('../services/searchRanking');
const { haversineDistanceKm } = require('../utils/geo');

const router = express.Router();

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'petrol_station', 'hotel'];
const DEFAULT_NEARBY_RADIUS_KM = 10;

// scripts/enrich-places.js fills these in later; default them to null so API
// consumers always see the fields rather than them being missing entirely.
function toPublicDestination(destination) {
  return {
    ...destination,
    placeId: destination.placeId ?? null,
    localImagePath: destination.localImagePath ?? null
  };
}

// Plain-text search used by GET /?q= only - smart-search below uses the
// scored ranking system (src/services/searchRanking.js) instead.
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

// GET /api/destinations/nearby?lat=<x>&lng=<y>&radiusKm=<optional, default 10>&category=<optional>
// Straight-line (haversine) distance from the given point to every
// destination, filtered to radiusKm and optionally by category, sorted
// nearest-first. Each result carries a distanceKm field (1 decimal) on
// top of its normal fields.
router.get('/nearby', async (req, res, next) => {
  try {
    const { lat, lng, radiusKm, category } = req.query;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (lat === undefined || lng === undefined || lat === '' || lng === ''
      || !Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'lat and lng are required and must be numeric' });
    }

    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `category must be one of: ${VALID_CATEGORIES.join(', ')}`
      });
    }

    const radius = radiusKm !== undefined && radiusKm !== '' ? Number(radiusKm) : DEFAULT_NEARBY_RADIUS_KM;
    if (!Number.isFinite(radius) || radius <= 0) {
      return res.status(400).json({ error: 'radiusKm must be a positive number' });
    }

    const db = await readDB();

    let results = db.destinations
      .map((d) => ({
        ...d,
        distanceKm: Math.round(haversineDistanceKm(latNum, lngNum, d.latitude, d.longitude) * 10) / 10
      }))
      .filter((d) => d.distanceKm <= radius);

    if (category) {
      results = results.filter((d) => d.category === category);
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);

    return res.json({ count: results.length, results: results.map(toPublicDestination) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/destinations/smart-search?q=<free text>
// Uses OpenRouter (if configured) to parse the query into signals, merges
// in whatever src/services/searchSynonyms.js also matches from the raw
// text, then scores + ranks every destination against the combined
// signals (src/services/searchRanking.js) - nothing is hard-filtered out
// for a partial mismatch, it just scores lower. If the AI is unavailable,
// the synonym table is the entire signal source (this replaces the old
// plain-keyword-search fallback). Never returns a true empty result
// unless the destinations list itself (or the requested category) has
// nothing in it - see searchRanking.js's fallback behavior.
router.get('/smart-search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    console.log(`[smart-search] query: ${JSON.stringify(q)}`);

    const db = await readDB();

    let aiParsed = true;
    let aiSignals = null;

    try {
      aiSignals = await parseSearchQuery(q, VALID_CATEGORIES);
      console.log('[smart-search] AI parsing succeeded:', aiSignals);
    } catch (err) {
      // AI_UNAVAILABLE (missing key, network/timeout error, both models
      // failed, or the model's response wasn't valid JSON) - the synonym
      // table becomes the entire signal source below.
      const reason = err && err.code === 'AI_UNAVAILABLE' ? err.message : `unexpected error: ${err.message}`;
      console.log(`[smart-search] AI parsing unavailable - reason: ${reason}`);
      aiParsed = false;
    }

    const synonymSignals = matchSignals(q);
    console.log('[smart-search] synonym-table signals:', synonymSignals);

    // Both sources contribute keywords (union, deduped); for a single-value
    // signal, the AI's value wins whenever it set one - the synonym table
    // only fills in what the AI left null, and is the entire source when
    // the AI failed (aiSignals is null, so every "??" falls through to it).
    const signals = {
      category: (aiSignals && aiSignals.category) ?? synonymSignals.category,
      neighborhood: (aiSignals && aiSignals.neighborhood) ?? null,
      priceLevel: (aiSignals && aiSignals.priceLevel) ?? synonymSignals.priceLevel,
      minRating: (aiSignals && aiSignals.minRating) ?? synonymSignals.minRating,
      keywords: [...new Set([...(aiSignals ? aiSignals.keywords : []), ...synonymSignals.keywords])]
    };
    console.log('[smart-search] combined signals:', signals);

    const { results, fallback } = rankDestinations(db.destinations, signals);

    console.log(
      `[smart-search] top ${Math.min(5, results.length)} score(s):`,
      results.slice(0, 5).map((d) => ({ name: d.name, score: scoreDestination(d, signals) }))
    );
    if (fallback) console.log(`[smart-search] fallback: ${fallback}`);

    return res.json({
      aiParsed,
      signals,
      fallback,
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
