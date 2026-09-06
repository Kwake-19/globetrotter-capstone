const express = require('express');
const { readDB } = require('../utils/dataStore');
const { optionalAuth } = require('../middleware/auth');
const { computeCategoryCounts, rankByCategoryAffinity } = require('../utils/personalization');
const { ensureSocialArrays, followingIds } = require('../utils/social');

const router = express.Router();

const FROM_FOLLOWING_LIMIT = 8;

/**
 * "From people you follow": destinations that accounts the current user
 * follows have reviewed, or added to an itinerary they've shared publicly.
 * Ranked by how many distinct followed users touched the place, then rating.
 * `excludeIds` drops places the user already has in their own itineraries.
 */
function computeFromFollowing(db, userId, excludeIds) {
  ensureSocialArrays(db);
  const following = new Set(followingIds(db, userId));
  if (following.size === 0) return [];

  const usersById = Object.fromEntries(db.users.map((u) => [u.id, u]));
  const destinationsById = Object.fromEntries(db.destinations.map((d) => [d.id, d]));
  const actorsByDestination = new Map(); // destId -> Map(actorId -> "reviewed"|"added")

  const touch = (destId, actorId, action) => {
    if (!actorsByDestination.has(destId)) actorsByDestination.set(destId, new Map());
    const actors = actorsByDestination.get(destId);
    // "reviewed" is the stronger signal - never downgrade it to "added".
    if (action === 'reviewed' || !actors.has(actorId)) actors.set(actorId, action);
  };

  (db.reviews || []).forEach((r) => {
    if (following.has(r.userId)) touch(r.destinationId, r.userId, 'reviewed');
  });
  (db.itineraries || []).forEach((it) => {
    if (!following.has(it.userId) || !it.shareId) return;
    it.items.forEach((item) => touch(item.destinationId, it.userId, 'added'));
  });

  const entries = [];
  actorsByDestination.forEach((actors, destId) => {
    if (excludeIds && excludeIds.has(destId)) return;
    const destination = destinationsById[destId];
    if (!destination) return;
    const followedBy = [...actors.entries()].map(([actorId, action]) => {
      const u = usersById[actorId];
      return { id: actorId, name: u ? u.name : null, username: u ? u.username : null, action };
    });
    entries.push({ ...destination, followedBy });
  });

  entries.sort((a, b) => (
    b.followedBy.length - a.followedBy.length
    || (b.rating || 0) - (a.rating || 0)
  ));
  return entries.slice(0, FROM_FOLLOWING_LIMIT);
}

/**
 * Very small recommendation algorithm for Phase 1:
 *  - Guests get the highest-rated places, spread across categories so the
 *    list isn't dominated by one type of place.
 *  - Logged-in users get places from the categories they've added to their
 *    itineraries before, ranked by rating; if they have no history yet we
 *    fall back to the same guest behaviour.
 * This is intentionally simple - Phase 4 (Resilience) is where caching and
 * smarter ranking would come in, not Phase 1.
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

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 18);
    const db = await readDB();

    if (!req.user) {
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(db.destinations, limit),
        fromFollowing: []
      });
    }

    const { categoryCounts, visitedIds } = computeCategoryCounts(db, req.user.id);
    const fromFollowing = computeFromFollowing(db, req.user.id, visitedIds);

    if (visitedIds.size === 0) {
      return res.json({
        personalized: false,
        results: topRatedAcrossCategories(db.destinations, limit),
        fromFollowing
      });
    }

    const candidates = db.destinations.filter((d) => !visitedIds.has(d.id));
    const ranked = rankByCategoryAffinity(candidates, categoryCounts);

    return res.json({
      personalized: true,
      basedOnCategories: Object.keys(categoryCounts),
      results: ranked.slice(0, limit),
      fromFollowing
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
