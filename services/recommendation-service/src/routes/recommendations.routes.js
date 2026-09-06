const express = require('express');
const { identity } = require('../middleware/identity');
const { fetchAllDestinations, fetchUserItinerariesSafe } = require('../utils/serviceClients');
const { computeCategoryCounts, rankByCategoryAffinity } = require('../utils/personalization');

const router = express.Router();

/**
 * Same small recommendation algorithm as the Phase 1 monolith:
 *  - Guests get the highest-rated places, spread across categories so the
 *    list isn't dominated by one type of place.
 *  - Logged-in users get places from the categories they've added to their
 *    itineraries before, ranked by rating; with no history yet we fall
 *    back to the same guest behaviour.
 * The only Phase 2 change is where the two inputs come from: the
 * destination catalog from destinations-service, the user's itineraries
 * from itinerary-service, both over HTTP.
 */
function topRatedAcrossCategories(destinations, limit) {
  const byCategory = {};
  destinations.forEach((d) => {
    byCategory[d.category] = byCategory[d.category] || [];
    byCategory[d.category].push(d);
  });
  Object.values(byCategory).forEach((list) => list.sort((a, b) => b.rating - a.rating));

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

router.get('/', identity, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 18);

    let destinations;
    try {
      destinations = await fetchAllDestinations();
    } catch (err) {
      return res.status(503).json({ error: 'Recommendations are temporarily unavailable - could not reach the destinations service' });
    }

    if (!req.userId) {
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(destinations, limit)
      });
    }

    const itineraries = await fetchUserItinerariesSafe(req.userId);

    const { categoryCounts, visitedIds } = computeCategoryCounts({ itineraries, destinations }, req.userId);

    if (visitedIds.size === 0) {
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(destinations, limit)
      });
    }

    const candidates = destinations.filter((d) => !visitedIds.has(d.id));
    const ranked = rankByCategoryAffinity(candidates, categoryCounts);

    return res.json({
      personalized: true,
      basedOnCategories: Object.keys(categoryCounts),
      results: ranked.slice(0, limit)
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
