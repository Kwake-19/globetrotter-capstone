/**
 * One-off, manual pruning script - NOT run by the server, and makes NO
 * Google API calls itself (works entirely off data already fetched by
 * populate-places.js / enrich-places.js).
 *
 *   node scripts/prune-places.js
 *   PRUNE_TARGET=100 node scripts/prune-places.js
 *
 * Always re-derives from the FULL candidate pool in
 * data/db.backup-before-prune.json (written once by populate-places.js,
 * never overwritten by this script) rather than compounding off whatever
 * db.json currently holds - so re-running at a different PRUNE_TARGET
 * always starts from the same ~555-place pool instead of narrowing an
 * already-narrowed set.
 *
 * Within each category, scores and keeps the top N (proportional to that
 * category's share of the pool) by, in priority order:
 *   1. Has a real downloaded photo (localImagePath) - "precise photos".
 *   2. Higher rating (prefers googleRating over the hand-entered fallback).
 *   3. Has a non-empty description.
 * Also drops anything whose name matches NAME_BLOCKLIST (same list as
 * populate-places.js - kept in sync manually, no shared module between
 * these one-off scripts).
 *
 * MANUAL_INCLUDE below is guaranteed a spot regardless of score - use it
 * for specific real, verified places you want kept even if the automated
 * scoring would otherwise drop them (e.g. Seven Hills, which didn't score
 * high enough to survive the first prune despite being a well-known real
 * spot). Add more entries the same way, using real data - never invent one.
 *
 * Deletes now-orphaned photo files under public/images/places/ for
 * anything dropped. If a MANUAL_INCLUDE entry's photo file no longer
 * exists on disk (e.g. it was deleted by an earlier prune), its
 * localImagePath is reset to null so the next enrich-places.js run
 * re-fetches it instead of leaving a broken image reference.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { readDB, writeDB } = require('../src/utils/dataStore');

const TARGET_TOTAL = process.env.PRUNE_TARGET ? parseInt(process.env.PRUNE_TARGET, 10) : 75;
// Hard floor, not just a scoring nudge - "best places" means genuinely
// well-rated, not just the best of a mediocre bunch.
const MIN_RATING = process.env.PRUNE_MIN_RATING ? parseFloat(process.env.PRUNE_MIN_RATING) : 4.0;
const SOURCE_FILE = path.join(__dirname, '..', 'data', 'db.backup-before-prune.json');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'places');

const NAME_BLOCKLIST_STARTS_WITH = [
  'tourist', 'trader', 'river', 'riviere', 'quartier', 'carrefour', 'junction', 'roundabout', 'zone'
];
const NAME_BLOCKLIST_EXACT_ONLY = ['marche'];

// Real, previously-verified places to always keep. See file header.
const MANUAL_INCLUDE = [
  {
    id: 'dest-chijsy7jgdpixar1gbuvib5ixc',
    name: 'Seven Hills',
    category: 'restaurant',
    neighborhood: 'Elig-Essono',
    description: 'Relaxed restaurant near Carrefour PJ known for pizza, burgers and a cozy dining room.',
    address: 'Carrefour PJ, Elig-Essono, Yaounde',
    latitude: 3.870794,
    longitude: 11.523396,
    rating: 4.2,
    googleRating: 4.2,
    priceLevel: 2,
    tags: [],
    placeId: 'ChIJsY7_jGDPixAR1GBuVib5iXc',
    localImagePath: '/images/places/dest-chijsy7jgdpixar1gbuvib5ixc.jpg'
  }
];

function isNameBlocked(name) {
  const normalized = (name || '').trim().toLowerCase();
  if (NAME_BLOCKLIST_EXACT_ONLY.includes(normalized)) return true;
  return NAME_BLOCKLIST_STARTS_WITH.some((word) => normalized === word || normalized.startsWith(`${word} `));
}

function meetsRatingFloor(destination) {
  const rating = typeof destination.googleRating === 'number' ? destination.googleRating : destination.rating;
  return typeof rating === 'number' && rating >= MIN_RATING;
}

function score(destination) {
  let s = 0;
  if (destination.localImagePath) s += 1000;
  const rating = typeof destination.googleRating === 'number' ? destination.googleRating : destination.rating;
  if (typeof rating === 'number') s += rating * 10;
  if (destination.description) s += 5;
  return s;
}

/** Resets localImagePath to null if the file it points at no longer exists on disk. */
function withVerifiedPhoto(destination) {
  if (!destination.localImagePath) return destination;
  const file = path.join(__dirname, '..', 'public', destination.localImagePath.replace(/^\//, ''));
  if (fs.existsSync(file)) return destination;
  return { ...destination, localImagePath: null };
}

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`${SOURCE_FILE} not found - run populate-places.js first to create the full candidate pool.`);
    process.exit(1);
  }

  const pool = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
  console.log(`Re-deriving from the full pool of ${pool.length} destinations in ${SOURCE_FILE}`);

  const manualIds = new Set(MANUAL_INCLUDE.map((d) => d.id));
  const survived = pool.filter((d) => !isNameBlocked(d.name) && !manualIds.has(d.id) && meetsRatingFloor(d));
  const belowRatingCount = pool.filter((d) => !manualIds.has(d.id) && !meetsRatingFloor(d)).length;
  const blockedCount = pool.length - survived.length - MANUAL_INCLUDE.length - belowRatingCount;

  const reservedForManual = MANUAL_INCLUDE.length;
  const automatedTarget = Math.max(0, TARGET_TOTAL - reservedForManual);

  const byCategory = {};
  survived.forEach((d) => {
    byCategory[d.category] = byCategory[d.category] || [];
    byCategory[d.category].push(d);
  });

  const scale = automatedTarget / survived.length;
  const kept = [];

  console.log('\nPer-category (pool -> kept):');
  Object.entries(byCategory).forEach(([category, list]) => {
    const target = Math.max(1, Math.round(list.length * scale));
    const sorted = list.slice().sort((a, b) => score(b) - score(a));
    const categoryKept = sorted.slice(0, target);
    kept.push(...categoryKept);
    console.log(`  ${category}: ${list.length} -> ${categoryKept.length}`);
  });

  const manualKept = MANUAL_INCLUDE.map(withVerifiedPhoto);
  manualKept.forEach((d) => {
    console.log(`  [manual include] ${d.name} (${d.category})${d.localImagePath ? '' : ' - photo missing, will be re-fetched by enrich-places.js'}`);
  });

  const finalList = [...kept, ...manualKept];

  const db = await readDB();
  db.destinations = finalList;
  await writeDB(db);

  const keptIds = new Set(finalList.map((d) => d.id));
  let deletedFiles = 0;
  if (fs.existsSync(IMAGES_DIR)) {
    fs.readdirSync(IMAGES_DIR).forEach((file) => {
      const id = file.replace(/\.[^.]+$/, '');
      if (!keptIds.has(id)) {
        fs.unlinkSync(path.join(IMAGES_DIR, file));
        deletedFiles += 1;
      }
    });
  }

  console.log(`\nDropped ${blockedCount} for blocked names, ${belowRatingCount} below the ${MIN_RATING} rating floor, ${survived.length - kept.length} for pruning to target size.`);
  console.log(`Removed ${deletedFiles} now-orphaned photo files.`);
  console.log(`Final total: ${finalList.length} (${kept.length} automated + ${manualKept.length} manual include)`);
}

main();
