const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');
const { isAdminUser } = require('../middleware/requireAdmin');
const { parseSearchQuery } = require('../services/aiSearch');
const { matchSignals } = require('../services/searchSynonyms');
const { rankDestinations, scoreDestination } = require('../services/searchRanking');
const { haversineDistanceKm } = require('../utils/geo');

const router = express.Router();

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'petrol_station', 'hotel'];
const DEFAULT_NEARBY_RADIUS_KM = 10;
const MAX_REVIEW_TEXT_LENGTH = 500;

// scripts/enrich-places.js fills placeId/localImagePath in later; default
// them to null so API consumers always see the fields rather than them
// being missing entirely. userRatingAvg/userRatingCount are computed from
// data/db.json's `reviews` array - kept separate from the existing
// Google-sourced `rating` field, never overwriting it.
function toPublicDestination(destination, allReviews) {
  const reviews = (allReviews || []).filter((r) => r.destinationId === destination.id);
  const userRatingCount = reviews.length;
  const userRatingAvg = userRatingCount > 0
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / userRatingCount) * 10) / 10
    : null;

  return {
    ...destination,
    placeId: destination.placeId ?? null,
    localImagePath: destination.localImagePath ?? null,
    userRatingAvg,
    userRatingCount
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

    return res.json({
      count: results.length,
      results: results.map((d) => toPublicDestination(d, db.reviews))
    });
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

    return res.json({
      count: results.length,
      results: results.map((d) => toPublicDestination(d, db.reviews))
    });
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

    // Real user language about a place is searchable too, at a lower
    // weight than a curated tag match (see searchRanking.js) - built as a
    // destinationId -> concatenated review text lookup so scoreDestination
    // doesn't need direct access to the whole reviews array.
    const reviewTextByDestinationId = {};
    (db.reviews || []).forEach((r) => {
      reviewTextByDestinationId[r.destinationId] = `${reviewTextByDestinationId[r.destinationId] || ''} ${r.text}`;
    });

    const { results, fallback } = rankDestinations(db.destinations, signals, reviewTextByDestinationId);

    console.log(
      `[smart-search] top ${Math.min(5, results.length)} score(s):`,
      results.slice(0, 5).map((d) => ({
        name: d.name,
        score: scoreDestination(d, signals, reviewTextByDestinationId[d.id])
      }))
    );
    if (fallback) console.log(`[smart-search] fallback: ${fallback}`);

    return res.json({
      aiParsed,
      signals,
      fallback,
      count: results.length,
      results: results.map((d) => toPublicDestination(d, db.reviews))
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
    return res.json(toPublicDestination(destination, db.reviews));
  } catch (err) {
    return next(err);
  }
});

function isValidReviewRating(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

// POST /api/destinations/:id/reviews - one review per user per destination;
// submitting again UPDATES the existing review rather than creating a
// duplicate.
router.post('/:id/reviews', requireAuth, async (req, res, next) => {
  try {
    const db = await readDB();
    const destination = db.destinations.find((d) => d.id === req.params.id);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    const { rating, text } = req.body || {};
    if (!isValidReviewRating(rating)) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const trimmedText = text.trim();
    if (trimmedText.length > MAX_REVIEW_TEXT_LENGTH) {
      return res.status(400).json({ error: `text must be ${MAX_REVIEW_TEXT_LENGTH} characters or fewer` });
    }

    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!db.reviews) db.reviews = [];
    const existing = db.reviews.find((r) => r.destinationId === destination.id && r.userId === req.user.id);

    let review;
    if (existing) {
      // Update in place - keep the original id/createdAt, refresh
      // everything else (userName is denormalized, so a since-changed
      // display name is picked up on the next edit).
      existing.rating = rating;
      existing.text = trimmedText;
      existing.userName = user.name;
      review = existing;
    } else {
      review = {
        id: uuidv4(),
        destinationId: destination.id,
        userId: req.user.id,
        userName: user.name,
        rating,
        text: trimmedText,
        createdAt: new Date().toISOString()
      };
      db.reviews.push(review);
    }

    await writeDB(db);
    return res.status(existing ? 200 : 201).json(review);
  } catch (err) {
    return next(err);
  }
});

// GET /api/destinations/:id/reviews - public, newest first, unpaginated (fine at this scale).
router.get('/:id/reviews', async (req, res, next) => {
  try {
    const db = await readDB();
    const destination = db.destinations.find((d) => d.id === req.params.id);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    const reviews = (db.reviews || [])
      .filter((r) => r.destinationId === destination.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ count: reviews.length, results: reviews });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/destinations/:id/reviews/:reviewId - only the review's own
// author or an admin (reuses requireAdmin's isAdminUser lookup) may delete it.
router.delete('/:id/reviews/:reviewId', requireAuth, async (req, res, next) => {
  try {
    const db = await readDB();
    const index = (db.reviews || []).findIndex(
      (r) => r.id === req.params.reviewId && r.destinationId === req.params.id
    );
    if (index === -1) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const review = db.reviews[index];
    const isAuthor = review.userId === req.user.id;
    if (!isAuthor && !isAdminUser(db, req.user.id)) {
      return res.status(403).json({ error: 'You can only delete your own reviews' });
    }

    db.reviews.splice(index, 1);
    await writeDB(db);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
