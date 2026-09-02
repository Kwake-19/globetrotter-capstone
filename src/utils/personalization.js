/**
 * Shared "categories from a user's past itineraries" personalization
 * signal, used by both /api/recommendations and
 * /api/destinations/smart-search so the two routes rank results the same
 * way instead of maintaining two copies of the same logic.
 */

/**
 * Looks at every destination a user has ever added to one of their
 * itineraries and counts how many times each category shows up.
 * Returns both the counts and the set of destination ids the user has
 * already used, so callers can exclude them from "new to you" results.
 */
function computeCategoryCounts(db, userId) {
  const userItineraries = db.itineraries.filter((it) => it.userId === userId);
  const visitedIds = new Set(
    userItineraries.flatMap((it) => it.items.map((item) => item.destinationId))
  );

  const visitedDestinations = db.destinations.filter((d) => visitedIds.has(d.id));
  const categoryCounts = {};
  visitedDestinations.forEach((d) => {
    categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
  });

  return { categoryCounts, visitedIds };
}

/**
 * A destination's score for ranking: mostly driven by how often the user
 * has picked its category before (a strong boost, x10), with rating as
 * the tiebreaker/secondary signal. With an empty categoryCounts (guests,
 * or a user with no history yet) this reduces to plain rating.
 */
function scoreByCategoryAffinity(destination, categoryCounts) {
  return (categoryCounts[destination.category] || 0) * 10 + (destination.rating || 0);
}

/** Returns a new array, sorted highest-scoring first. */
function rankByCategoryAffinity(destinations, categoryCounts) {
  return destinations
    .slice()
    .sort((a, b) => scoreByCategoryAffinity(b, categoryCounts) - scoreByCategoryAffinity(a, categoryCounts));
}

module.exports = { computeCategoryCounts, scoreByCategoryAffinity, rankByCategoryAffinity };
