/**
 * One-off, manual script - NOT run by the server. No photo downloads (that's
 * enrich-places.js) - just fetches real amenity attributes from Google
 * Place Details (New) and uses them to build richer `tags` and a fallback
 * `description` when Google's editorialSummary is empty (which is most of
 * the time). Every value written comes directly from Google - nothing is
 * invented.
 *
 *   node scripts/enrich-descriptions.js
 *
 * Safe to re-run - only touches destinations missing tags AND description.
 */
require('dotenv').config();
const { readDB, writeDB } = require('../src/utils/dataStore');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_API_BASE = 'https://places.googleapis.com/v1';
const REQUEST_DELAY_MS = 200;

const AMENITY_FIELDS = [
  'editorialSummary', 'servesBeer', 'servesWine', 'servesCocktails', 'servesCoffee',
  'servesBreakfast', 'servesLunch', 'servesDinner', 'servesDessert', 'servesVegetarianFood',
  'outdoorSeating', 'delivery', 'takeout', 'dineIn', 'reservable',
  'goodForChildren', 'goodForGroups', 'liveMusic'
];

// Maps a truthy amenity field to a human-readable tag.
const TAG_LABELS = {
  servesBeer: 'beer', servesWine: 'wine', servesCocktails: 'cocktails', servesCoffee: 'coffee',
  servesBreakfast: 'breakfast', servesLunch: 'lunch', servesDinner: 'dinner',
  servesDessert: 'dessert', servesVegetarianFood: 'vegetarian-friendly',
  outdoorSeating: 'outdoor-seating', delivery: 'delivery', takeout: 'takeout',
  dineIn: 'dine-in', reservable: 'reservations', goodForChildren: 'family-friendly',
  goodForGroups: 'good-for-groups', liveMusic: 'live-music'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAmenities(placeId) {
  const res = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': AMENITY_FIELDS.join(',') }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
  }
  return res.json();
}

function buildTags(details) {
  return Object.keys(TAG_LABELS).filter((field) => details[field] === true).map((field) => TAG_LABELS[field]);
}

function buildFallbackDescription(destination, tags) {
  const parts = [];
  if (destination.category === 'restaurant' || destination.category === 'ice_cream') {
    const serves = tags.filter((t) => ['wine', 'beer', 'cocktails', 'coffee', 'dessert'].includes(t));
    if (serves.length) parts.push(`Serves ${serves.join(', ')}`);
    if (tags.includes('outdoor-seating')) parts.push('has outdoor seating');
    if (tags.includes('family-friendly')) parts.push('family-friendly');
  }
  if (tags.includes('reservations')) parts.push('takes reservations');
  if (tags.includes('good-for-groups')) parts.push('good for groups');

  if (parts.length === 0) return '';
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} in ${destination.neighborhood}.`;
}

async function main() {
  if (!API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }

  const db = await readDB();
  const total = db.destinations.length;
  let processed = 0;

  for (let i = 0; i < total; i++) {
    const destination = db.destinations[i];
    const progress = `[${i + 1}/${total}]`;

    if (!destination.placeId) {
      console.log(`${progress} ${destination.name} - no placeId, skipping`);
      continue;
    }
    if ((destination.tags && destination.tags.length > 0) && destination.description) {
      console.log(`${progress} ${destination.name} - already has tags and a description, skipping`);
      continue;
    }

    try {
      const details = await fetchAmenities(destination.placeId);
      await sleep(REQUEST_DELAY_MS);

      const tags = buildTags(details);
      if (tags.length > 0) destination.tags = tags;

      if (!destination.description) {
        const editorial = details.editorialSummary && details.editorialSummary.text;
        destination.description = editorial || buildFallbackDescription(destination, tags);
      }

      console.log(`${progress} ${destination.name} - ${tags.length} tags${destination.description ? ', description set' : ''}`);
      processed += 1;
      await writeDB(db);
    } catch (err) {
      console.error(`${progress} ${destination.name} - error: ${err.message}`);
    }
  }

  console.log(`\nDone. Updated ${processed}/${total} destinations.`);
}

main();
