const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/dataStore');
const { identity, requireUserId } = require('../middleware/identity');
const { haversineDistanceKm } = require('../utils/geo');

const router = express.Router();

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'petrol_station', 'hotel'];
const DEFAULT_NEARBY_RADIUS_KM = 10;
const MAX_REVIEW_TEXT_LENGTH = 500;

// scripts/enrich-places.js fills placeId/localImagePath in later; default
// them to null so API consumers always see the fields. userRatingAvg/
// userRatingCount are computed from this service's `reviews` array - kept
// separate from the Google-sourced `rating` field, never overwriting it.
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

// Plain-text search used by GET /?q= only.
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
// duplicate. The author's display name is denormalized onto the review -
// in the monolith it came from the users table, here it comes from the
// X-User-Name header the gateway forwards off the verified JWT.
router.post('/:id/reviews', identity, requireUserId, async (req, res, next) => {
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

    const authorName = req.userName || 'GlobeTrotter user';

    if (!db.reviews) db.reviews = [];
    const existing = db.reviews.find((r) => r.destinationId === destination.id && r.userId === req.userId);

    let review;
    if (existing) {
      // Update in place - keep the original id/createdAt, refresh the rest
      // (userName is denormalized, so a since-changed display name is
      // picked up on the next edit).
      existing.rating = rating;
      existing.text = trimmedText;
      existing.userName = authorName;
      review = existing;
    } else {
      review = {
        id: uuidv4(),
        destinationId: destination.id,
        userId: req.userId,
        userName: authorName,
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

// GET /api/destinations/:id/reviews - public, newest first, unpaginated.
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

// DELETE /api/destinations/:id/reviews/:reviewId - the review's own author
// or an admin (X-Is-Admin header) may delete it.
router.delete('/:id/reviews/:reviewId', identity, requireUserId, async (req, res, next) => {
  try {
    const db = await readDB();
    const index = (db.reviews || []).findIndex(
      (r) => r.id === req.params.reviewId && r.destinationId === req.params.id
    );
    if (index === -1) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const review = db.reviews[index];
    const isAuthor = review.userId === req.userId;
    if (!isAuthor && !req.isAdmin) {
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
