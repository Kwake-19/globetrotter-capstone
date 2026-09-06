/**
 * Scores every destination against a set of search signals and ranks them
 * - replaces the old hard AND/OR filter logic in smart-search. Nothing is
 * ever excluded outright for a partial mismatch; it just scores lower and
 * sorts further down, the way a real search engine behaves.
 */

// A very broad query can otherwise "match" (score > 0, mostly from the
// rating tiebreaker) every destination in the dataset - cap it so results
// stay a manageable, genuinely-ranked list.
const RESULT_CAP = 20;
const FALLBACK_SIZE = 5;

/**
 * Computes a single destination's relevance score for the given signals.
 * Starts at 0 and adds points for each signal that matches, plus a small
 * rating-based tiebreaker for every destination (so equally-relevant
 * places still sort with the better-rated one first).
 *
 * `reviewText` (optional) is that destination's user reviews concatenated
 * into one string - passed in rather than read off `destination` itself
 * so this function stays a pure, side-effect-free scorer and the caller
 * controls how review text gets looked up (see destinations.routes.js's
 * smart-search handler).
 */
function scoreDestination(destination, signals, reviewText = '') {
  let score = 0;

  if (signals.category && destination.category === signals.category) {
    score += 40;
  }

  if (signals.neighborhood && destination.neighborhood
    && destination.neighborhood.toLowerCase().includes(signals.neighborhood.toLowerCase())) {
    score += 25;
  }

  // Never penalize a destination for having no priceLevel set (a lot of
  // the curated data doesn't) - just don't reward it either.
  if (signals.priceLevel != null && destination.priceLevel != null
    && destination.priceLevel === signals.priceLevel) {
    score += 20;
  }

  if (signals.minRating != null && typeof destination.rating === 'number'
    && destination.rating >= signals.minRating) {
    score += 15;
  }

  const tags = (destination.tags || []).map((tag) => tag.toLowerCase());
  const name = (destination.name || '').toLowerCase();
  const description = (destination.description || '').toLowerCase();
  const reviews = (reviewText || '').toLowerCase();

  (signals.keywords || []).forEach((rawKeyword) => {
    const keyword = rawKeyword.toLowerCase();
    if (tags.includes(keyword)) score += 10;
    if (name.includes(keyword)) score += 6;
    if (description.includes(keyword)) score += 4;
    // Lower weight than a tag/description match - real review text is
    // useful search signal, but less curated/reliable than the rest.
    if (reviews.includes(keyword)) score += 3;
  });

  if (typeof destination.rating === 'number') {
    score += destination.rating * 2;
  }

  return score;
}

// Sorts by rating where available, but doesn't drop destinations that
// have no rating - they just sort last. A category that genuinely has
// destinations (just none of them rated) should still get a fallback
// list, not an empty one; the only truly empty case left is a category
// with zero destinations, or an empty destinations list altogether.
function topRated(destinations, limit) {
  return destinations
    .slice()
    .sort((a, b) => (typeof b.rating === 'number' ? b.rating : -Infinity)
      - (typeof a.rating === 'number' ? a.rating : -Infinity))
    .slice(0, limit);
}

/**
 * Scores and sorts `destinations` against `signals`, descending. Returns
 * { results, fallback }:
 *  - Normal case: every destination that scored above 0, capped at
 *    RESULT_CAP, `fallback: null`.
 *  - If NOTHING scored above 0 (only realistically possible when ratings
 *    are missing across the board, or the destinations list itself is
 *    thin) and a category was requested: the top rated places in that
 *    category, `fallback: "category-popular"`.
 *  - Same, but no category was requested: the top rated places overall,
 *    `fallback: "popular"`.
 * The only way this returns a genuinely empty result is an empty
 * `destinations` list, or a category-popular fallback for a category
 * that has zero destinations at all.
 *
 * `reviewTextByDestinationId` (optional) maps a destination id to its
 * concatenated review text, forwarded to scoreDestination() for each one.
 */
function rankDestinations(destinations, signals, reviewTextByDestinationId = {}) {
  const scored = destinations
    .map((destination) => ({
      destination,
      score: scoreDestination(destination, signals, reviewTextByDestinationId[destination.id])
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return {
      results: scored.slice(0, RESULT_CAP).map((entry) => entry.destination),
      fallback: null
    };
  }

  if (signals.category) {
    const inCategory = destinations.filter((d) => d.category === signals.category);
    return { results: topRated(inCategory, FALLBACK_SIZE), fallback: 'category-popular' };
  }

  return { results: topRated(destinations, FALLBACK_SIZE), fallback: 'popular' };
}

module.exports = { rankDestinations, scoreDestination };
