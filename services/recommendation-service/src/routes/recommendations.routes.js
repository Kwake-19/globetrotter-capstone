const express = require('express');
const { readDB } = require('../utils/dataStore');
const { optionalAuth } = require('../middleware/auth');
const { fetchUserItineraries } = require('../utils/itineraryClient');

const router = express.Router();

/**
 * Very small recommendation algorithm, unchanged from Phase 1:
 *  - Guests get the highest-rated places, spread across categories so the
 *    list isn't dominated by one type of place.
 *  - Logged-in users get places from the categories they've added to their
 *    itineraries before, ranked by rating; if they have no history yet we
 *    fall back to the same guest behaviour.
 * `timesAdded` (kept up to date asynchronously via the itinerary.* events
 * from RabbitMQ) is used only as a tie-breaker, so a destination frequently
 * added by *other* users nudges ahead of an equally-rated one that isn't.
 */
function topRatedAcrossCategories(destinations, limit) {
  const byCategory = {};
  destinations.forEach((d) => {
    byCategory[d.category] = byCategory[d.category] || [];
    byCategory[d.category].push(d);
  });
  Object.values(byCategory).forEach((list) => list.sort((a, b) => b.rating - a.rating || (b.timesAdded || 0) - (a.timesAdded || 0)));

  const categories = Object.keys(byCategory);
  const results = [];
  let i = 0;
  while (results.length < limit && results.length < destinations.length) {
    const category = categories[i % categories.length];
    const list = byCategory[category];
    const next = list.shift();
    if (next) results.push(next);
    i += 1;
    if (categories.every((c) => byCategory[c].length === 0)) break;
  }
  return results;
}

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 18);
    const db = await readDB();

    if (!req.user) {
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(db.destinations, limit)
      });
    }

    let userItineraries;
    try {
      userItineraries = await fetchUserItineraries(req.headers.authorization);
    } catch (err) {
      // Itinerary Service being down shouldn't take recommendations down
      // with it - degrade to the guest experience instead.
      console.warn('[recommendation-service] Falling back to non-personalized recommendations:', err.message);
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(db.destinations, limit)
      });
    }

    const visitedIds = new Set(
      userItineraries.flatMap((it) => it.items.map((item) => item.destinationId))
    );

    if (visitedIds.size === 0) {
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(db.destinations, limit)
      });
    }

    const visitedDestinations = db.destinations.filter((d) => visitedIds.has(d.id));
    const categoryCounts = {};
    visitedDestinations.forEach((d) => {
      categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
    });

    const candidates = db.destinations.filter((d) => !visitedIds.has(d.id));
    candidates.sort((a, b) => {
      const scoreA = (categoryCounts[a.category] || 0) * 10 + a.rating;
      const scoreB = (categoryCounts[b.category] || 0) * 10 + b.rating;
      return scoreB - scoreA;
    });

    return res.json({
      personalized: true,
      basedOnCategories: Object.keys(categoryCounts),
      results: candidates.slice(0, limit)
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
