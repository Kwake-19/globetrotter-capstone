/**
 * One-off, manual enrichment script - NOT loaded or run by the server.
 *
 *   node scripts/enrich-places.js
 *
 * For each destination in data/db.json that doesn't yet have a
 * localImagePath, looks it up via the Places API (New) (Text Search ->
 * Place Details -> Place Photo media), downloads one photo into
 * public/images/places/<destination-id>.jpg, and writes placeId,
 * googleRating and localImagePath back into that destination's entry in
 * data/db.json. The hand-entered `rating` field is left untouched as a
 * fallback.
 *
 * Uses Places API (New), not the legacy Places API - the legacy API was
 * frozen in March 2025 and can no longer be enabled on new Google Cloud
 * projects, so a fresh API key only has access to the new one.
 *
 * Safe to re-run: destinations that already have a localImagePath are
 * skipped, so re-running only fetches newly added destinations. Progress is
 * saved after every destination, so an interrupted run can just be re-run.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { readDB, writeDB } = require('../src/utils/dataStore');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'places');
const REQUEST_DELAY_MS = 200;
const PHOTO_MAX_WIDTH = 800;
const PLACES_API_BASE = 'https://places.googleapis.com/v1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(url, options, label) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) {
    const message = (body.error && body.error.message) || `HTTP ${res.status}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return body;
}

async function findPlaceId(destination) {
  const query = `${destination.name}, ${destination.address}`;
  const body = await apiRequest(
    `${PLACES_API_BASE}/places:searchText`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id'
      },
      body: JSON.stringify({ textQuery: query })
    },
    'Text Search'
  );
  const place = body.places && body.places[0];
  return place ? place.id : null;
}

async function getPlaceDetails(placeId) {
  return apiRequest(
    `${PLACES_API_BASE}/places/${placeId}`,
    { headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'rating,photos' } },
    'Place Details'
  );
}

async function downloadPhoto(photoName, destPath) {
  const url = `${PLACES_API_BASE}/${photoName}/media?maxWidthPx=${PHOTO_MAX_WIDTH}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return true;
}

async function processDestination(destination, progress) {
  let placeId = destination.placeId || null;

  if (!placeId) {
    placeId = await findPlaceId(destination);
    await sleep(REQUEST_DELAY_MS);
  }

  if (!placeId) {
    console.log(`${progress} ${destination.name} - no match, skipping`);
    return false;
  }

  const details = await getPlaceDetails(placeId);
  await sleep(REQUEST_DELAY_MS);

  destination.placeId = placeId;
  if (details && typeof details.rating === 'number') {
    destination.googleRating = details.rating;
  }

  const photo = details && details.photos && details.photos[0];
  if (!photo) {
    console.log(`${progress} ${destination.name} - place found but no photo available, skipping`);
    return true;
  }

  const destPath = path.join(IMAGES_DIR, `${destination.id}.jpg`);
  const downloaded = await downloadPhoto(photo.name, destPath);
  await sleep(REQUEST_DELAY_MS);

  if (!downloaded) {
    console.log(`${progress} ${destination.name} - photo download failed, skipping`);
    return true;
  }

  destination.localImagePath = `/images/places/${destination.id}.jpg`;
  console.log(`${progress} ${destination.name} - found photo`);
  return true;
}

async function main() {
  if (!API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not set. Add it to .env before running this script.');
    process.exit(1);
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const db = await readDB();
  const total = db.destinations.length;

  for (let i = 0; i < total; i++) {
    const destination = db.destinations[i];
    const progress = `[${i + 1}/${total}]`;

    if (destination.localImagePath) {
      console.log(`${progress} ${destination.name} - already processed, skipping`);
      continue;
    }

    try {
      const changed = await processDestination(destination, progress);
      if (changed) {
        await writeDB(db);
      }
    } catch (err) {
      console.error(`${progress} ${destination.name} - error: ${err.message}`);
    }
  }

  console.log('Done.');
}

main();
