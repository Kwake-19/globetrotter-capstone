/**
 * One-off, manual bulk-population script - NOT loaded or run by the server.
 *
 *   node scripts/populate-places.js
 *
 * Replaces the whole data/db.json "destinations" array with places pulled
 * live from the Places API (New) Text Search endpoint, across a handful of
 * search phrases per category. Run this BEFORE scripts/enrich-places.js
 * (which fetches photos) so photo-fetching only happens once per unique
 * place, not once per duplicate match across phrases.
 *
 * Uses Places API (New), not the legacy Places API - the legacy API was
 * frozen in March 2025 and can no longer be enabled on new Google Cloud
 * projects, so a fresh API key only has access to the new one.
 *
 * The previous "destinations" array is backed up to data/db.backup.json
 * first. "users" and "itineraries" are left untouched.
 *
 * FILTERING (see CATEGORY_TYPE_WHITELIST / ALWAYS_EXCLUDED_TYPES /
 * NAME_BLOCKLIST below): a raw Text Search result is only kept if it
 * survives, in order: excluded-type check, category type-whitelist check,
 * business_status check, review-count threshold, name blocklist. This is
 * deliberately strict - Google's generic "point of interest"-style types
 * let a lot of neighborhoods, roads and informal/unverified entries slip
 * through a looser check.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { readDB, writeDB } = require('../src/utils/dataStore');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_API_BASE = 'https://places.googleapis.com/v1';
const REQUEST_DELAY_MS = 200;
const NEXT_PAGE_DELAY_MS = 2500; // Google requires ~2s before a pageToken becomes valid.
const MAX_PAGES_PER_PHRASE = 3; // Google caps Text Search at 60 results (3 pages of 20) per query.
const BACKUP_FILE = path.join(__dirname, '..', 'data', 'db.backup.json');
const POOL_FILE = path.join(__dirname, '..', 'data', 'db.backup-before-prune.json');
const MIN_USER_RATING_COUNT = 5;

const SEARCH_PHRASES = {
  restaurant: ['restaurants in Yaounde', 'restaurants Bastos Yaounde', 'restaurants Centre-ville Yaounde'],
  ice_cream: ['ice cream Yaounde', 'dessert shop Yaounde'],
  mall: ['shopping mall Yaounde', 'supermarket Yaounde'],
  fun_place: ['tourist attractions Yaounde', 'museums Yaounde', 'parks Yaounde'],
  hotel: ['hotels in Yaounde', 'hotels Bastos Yaounde', 'hotels Centre-ville Yaounde'],
  petrol_station: ['petrol station Yaounde', 'gas station Yaounde']
};

// Each result must carry at least one of these types for its category, or
// it's discarded regardless of anything else in its types array.
const CATEGORY_TYPE_WHITELIST = {
  restaurant: ['restaurant', 'meal_takeaway', 'meal_delivery'],
  // Deliberately excludes plain "restaurant" - overlaps too much with the restaurant category.
  ice_cream: ['cafe', 'bakery'],
  mall: ['shopping_mall', 'department_store', 'supermarket'],
  fun_place: ['tourist_attraction', 'museum', 'amusement_park', 'zoo', 'art_gallery', 'stadium', 'aquarium'],
  hotel: ['lodging'],
  petrol_station: ['gas_station']
};

// A result carrying any of these is discarded outright, even if it also
// carries a category-matching type - e.g. a river or neighborhood that
// happens to also be tagged with something else.
const ALWAYS_EXCLUDED_TYPES = [
  'locality', 'sublocality', 'neighborhood', 'political', 'route',
  'natural_feature', 'administrative_area_level_1', 'administrative_area_level_2', 'plus_code'
];

// Backstop for obvious junk with generic single/two-word names that slips
// past the type/review filters above. Blunt on purpose - see file header.
// "marche" is exact-match only (not startsWith) so it doesn't also reject
// real market names like "Marché Central".
const NAME_BLOCKLIST_STARTS_WITH = [
  'tourist', 'trader', 'river', 'riviere', 'quartier', 'carrefour', 'junction', 'roundabout', 'zone'
];
const NAME_BLOCKLIST_EXACT_ONLY = ['marche'];

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.addressComponents',
  'places.editorialSummary',
  'places.types',
  'places.businessStatus',
  'nextPageToken'
].join(',');

// Places API (New) uses enum strings instead of the legacy 0-4 integer -
// map back onto that same rough numeric scale to match the rest of the schema.
const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

const NEIGHBORHOOD_TYPES = ['sublocality_level_1', 'sublocality', 'neighborhood'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(placeId) {
  return `dest-${placeId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function guessNeighborhood(addressComponents) {
  if (!Array.isArray(addressComponents)) return 'Yaounde';
  for (const type of NEIGHBORHOOD_TYPES) {
    const match = addressComponents.find((c) => Array.isArray(c.types) && c.types.includes(type));
    if (match && match.longText) return match.longText;
  }
  return 'Yaounde';
}

function toDestination(place, category) {
  return {
    id: slugify(place.id),
    name: (place.displayName && place.displayName.text) || 'Unnamed place',
    category,
    neighborhood: guessNeighborhood(place.addressComponents),
    description: (place.editorialSummary && place.editorialSummary.text) || '',
    address: place.formattedAddress || 'Yaounde',
    latitude: place.location ? place.location.latitude : null,
    longitude: place.location ? place.location.longitude : null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    priceLevel: PRICE_LEVEL_MAP[place.priceLevel] || null,
    tags: [],
    placeId: place.id
  };
}

function isNameBlocked(name) {
  const normalized = (name || '').trim().toLowerCase();
  if (NAME_BLOCKLIST_EXACT_ONLY.includes(normalized)) return true;
  return NAME_BLOCKLIST_STARTS_WITH.some((word) => normalized === word || normalized.startsWith(`${word} `));
}

/**
 * Checks one raw result against every filter in priority order and returns
 * either { keep: true } or { keep: false, reason: 'type'|'status'|'reviews'|'name' }.
 */
function evaluateResult(place, category) {
  const types = Array.isArray(place.types) ? place.types : [];

  if (types.some((t) => ALWAYS_EXCLUDED_TYPES.includes(t))) {
    return { keep: false, reason: 'type' };
  }
  const whitelist = CATEGORY_TYPE_WHITELIST[category] || [];
  if (!types.some((t) => whitelist.includes(t))) {
    return { keep: false, reason: 'type' };
  }
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    return { keep: false, reason: 'status' };
  }
  if (!place.userRatingCount || place.userRatingCount < MIN_USER_RATING_COUNT) {
    return { keep: false, reason: 'reviews' };
  }
  const name = (place.displayName && place.displayName.text) || '';
  if (isNameBlocked(name)) {
    return { keep: false, reason: 'name' };
  }
  return { keep: true };
}

/** Runs one Text Search phrase to completion, following pagination up to the page cap. */
async function searchPhrase(textQuery, onResults) {
  let pageToken = null;

  for (let page = 0; page < MAX_PAGES_PER_PHRASE; page++) {
    const body = pageToken ? { textQuery, pageToken } : { textQuery };
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': SEARCH_FIELD_MASK
      },
      body: JSON.stringify(body)
    });
    const json = await res.json();

    if (!res.ok) {
      // If we just got a pageToken, Google may not have made it valid yet -
      // wait a bit longer and retry once before giving up on this phrase.
      if (pageToken) {
        await sleep(NEXT_PAGE_DELAY_MS);
        const retryRes = await fetch(`${PLACES_API_BASE}/places:searchText`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
            'X-Goog-FieldMask': SEARCH_FIELD_MASK
          },
          body: JSON.stringify(body)
        });
        const retryJson = await retryRes.json();
        if (!retryRes.ok) {
          console.warn(`  "${textQuery}" page ${page + 1} failed twice, stopping pagination for this phrase.`);
          return;
        }
        onResults(retryJson.places || []);
        if (!retryJson.nextPageToken) return;
        pageToken = retryJson.nextPageToken;
        await sleep(NEXT_PAGE_DELAY_MS);
        continue;
      }
      const message = (json.error && json.error.message) || `HTTP ${res.status}`;
      throw new Error(`Text Search failed: ${message}`);
    }

    onResults(json.places || []);

    if (!json.nextPageToken) return;
    pageToken = json.nextPageToken;
    await sleep(NEXT_PAGE_DELAY_MS);
  }
}

async function main() {
  if (!API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }

  const db = await readDB();
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(db.destinations, null, 2));
  console.log(`Backed up ${db.destinations.length} existing destinations to ${BACKUP_FILE}`);

  const seenPlaceIds = new Map(); // placeId -> { destination, category }
  const categoryCounts = {};
  const ambiguousMatches = [];
  const grandTotals = { found: 0, type: 0, status: 0, reviews: 0, name: 0, kept: 0 };

  for (const [category, phrases] of Object.entries(SEARCH_PHRASES)) {
    categoryCounts[category] = 0;

    for (const phrase of phrases) {
      const phraseTotals = { found: 0, type: 0, status: 0, reviews: 0, name: 0, kept: 0 };

      try {
        await searchPhrase(phrase, (places) => {
          places.forEach((place) => {
            phraseTotals.found += 1;

            const verdict = evaluateResult(place, category);
            if (!verdict.keep) {
              phraseTotals[verdict.reason] += 1;
              return;
            }

            const existing = seenPlaceIds.get(place.id);
            if (existing) {
              if (existing.category !== category) {
                ambiguousMatches.push({
                  name: existing.destination.name,
                  placeId: place.id,
                  keptCategory: existing.category,
                  alsoMatches: category
                });
              }
              return;
            }

            const destination = toDestination(place, category);
            seenPlaceIds.set(place.id, { destination, category });
            categoryCounts[category] += 1;
            phraseTotals.kept += 1;
          });
        });
      } catch (err) {
        console.error(`  "${phrase}" failed: ${err.message}`);
      }

      console.log(
        `"${phrase}" (${category}): found ${phraseTotals.found}, ` +
        `discarded type ${phraseTotals.type}, status ${phraseTotals.status}, ` +
        `reviews ${phraseTotals.reviews}, name ${phraseTotals.name}, kept ${phraseTotals.kept}`
      );
      Object.keys(grandTotals).forEach((key) => { grandTotals[key] += phraseTotals[key]; });

      await sleep(REQUEST_DELAY_MS);
    }
  }

  db.destinations = Array.from(seenPlaceIds.values()).map((v) => v.destination);
  await writeDB(db);

  // Also write the full pool separately (untouched by later pruning) so
  // scripts/prune-places.js can always re-derive from every candidate
  // found here, not just whatever db.json currently holds.
  fs.writeFileSync(POOL_FILE, JSON.stringify(db.destinations, null, 2));
  console.log(`Wrote the full ${db.destinations.length}-place pool to ${POOL_FILE}`);

  if (ambiguousMatches.length > 0) {
    console.log('\nAmbiguous category matches (kept first-found category, review manually):');
    ambiguousMatches.forEach((m) => {
      console.log(`  "${m.name}" (${m.placeId}) - kept as ${m.keptCategory}, also matches ${m.alsoMatches}`);
    });
  }

  console.log('\nOverall discarded: ' +
    `type ${grandTotals.type}, status ${grandTotals.status}, reviews ${grandTotals.reviews}, name ${grandTotals.name} ` +
    `(of ${grandTotals.found} raw results found)`);

  console.log('\nPer-category counts:');
  Object.entries(categoryCounts).forEach(([category, count]) => {
    console.log(`  ${category}: ${count}`);
  });
  console.log(`Total unique places: ${db.destinations.length}`);
}

main();
