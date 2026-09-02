/**
 * Maps common ways people phrase a search query to structured signals -
 * { category, priceLevel, minRating, keywords }. Used two ways by
 * smart-search (see src/routes/destinations.routes.js):
 *   - To supplement the AI's parsed signals (in case the AI didn't
 *     confidently set a category, or missed a price/quality/vibe cue).
 *   - As the ENTIRE signal source when the AI is unavailable - this
 *     replaces the old plain-keyword-search fallback.
 *
 * Deliberately simple phrase-list matching (case-insensitive, checked
 * against the whole query text) rather than real NLP - this app's
 * queries are short, casual sentences, so that's good enough.
 */

const PRICE_SYNONYMS = [
  { phrases: ['budget', 'cheap', 'affordable', 'inexpensive', 'low-cost'], priceLevel: 1 },
  { phrases: ['mid-range', 'moderate'], priceLevel: 2 },
  { phrases: ['luxury', 'upscale', 'high-end', 'expensive', 'premium'], priceLevel: 3 }
];

const QUALITY_SYNONYMS = [
  { phrases: ['best', 'top-rated', 'top', 'highly-rated', 'great'], minRating: 4.0 }
];

// vibe/amenity words -> tag words to look for. Most destinations have
// empty tags today (tags are filled in by hand, not by any script - see
// scripts/generate-descriptions.js's docstring) so this mostly won't
// score anything yet. It's here so it starts working the moment tags get
// filled in, with no further code changes needed.
const VIBE_SYNONYMS = [
  { phrases: ['family', 'kids', 'family-friendly'], tags: ['family-friendly', 'kids'] },
  { phrases: ['romantic', 'date'], tags: ['romantic', 'quiet'] },
  { phrases: ['quiet', 'calm', 'peaceful'], tags: ['quiet'] },
  { phrases: ['view', 'scenic', 'rooftop'], tags: ['view', 'rooftop'] },
  { phrases: ['pool', 'swimming'], tags: ['pool'] },
  { phrases: ['24hr', 'late-night', 'open-late'], tags: ['24hr'] },
  { phrases: ['outdoor', 'terrace'], tags: ['outdoor-seating'] }
];

// In case the AI doesn't confidently set a category, or is unavailable.
const CATEGORY_SYNONYMS = [
  { phrases: ['hotel', 'stay', 'lodging', 'sleep'], category: 'hotel' },
  { phrases: ['restaurant', 'eat', 'food', 'dine'], category: 'restaurant' },
  { phrases: ['ice cream', 'dessert', 'sweet'], category: 'ice_cream' },
  { phrases: ['mall', 'shop', 'shopping'], category: 'mall' },
  { phrases: ['fuel', 'gas', 'petrol'], category: 'petrol_station' },
  { phrases: ['attraction', 'museum', 'park', 'sightseeing', 'things to do'], category: 'fun_place' }
];

/**
 * Whether `phrase` occurs in `term` (both already lowercase). A single
 * alphanumeric word (e.g. "top", "eat", "hotel") is matched on word
 * boundaries, tolerating a simple trailing "s" (so "hotel" also matches
 * "hotels", "mall" also matches "malls"), so it doesn't false-positive
 * inside an unrelated word ("top" in "laptop", "eat" in "great"); a
 * multi-word or hyphenated phrase (e.g. "ice cream", "high-end") is
 * matched with a plain substring check.
 */
function phraseMatches(term, phrase) {
  if (/^[a-z0-9]+$/i.test(phrase)) {
    return new RegExp(`\\b${phrase}s?\\b`, 'i').test(term);
  }
  return term.includes(phrase);
}

function matchesAny(term, entry) {
  return entry.phrases.some((phrase) => phraseMatches(term, phrase));
}

/**
 * Matches free text against the synonym table and returns
 * { category, priceLevel, minRating, keywords }. Fields that didn't
 * match anything come back null (or [] for keywords), never throws.
 */
function matchSignals(queryText) {
  const term = (queryText || '').toLowerCase();

  const priceMatch = PRICE_SYNONYMS.find((entry) => matchesAny(term, entry));
  const qualityMatch = QUALITY_SYNONYMS.find((entry) => matchesAny(term, entry));
  const categoryMatch = CATEGORY_SYNONYMS.find((entry) => matchesAny(term, entry));

  const keywords = [];
  VIBE_SYNONYMS.forEach((entry) => {
    if (matchesAny(term, entry)) keywords.push(...entry.tags);
  });

  return {
    category: categoryMatch ? categoryMatch.category : null,
    priceLevel: priceMatch ? priceMatch.priceLevel : null,
    minRating: qualityMatch ? qualityMatch.minRating : null,
    keywords: [...new Set(keywords)]
  };
}

module.exports = {
  PRICE_SYNONYMS,
  QUALITY_SYNONYMS,
  VIBE_SYNONYMS,
  CATEGORY_SYNONYMS,
  matchSignals
};
