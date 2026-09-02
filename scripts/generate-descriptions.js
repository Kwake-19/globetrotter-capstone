/**
 * One-off, manual enrichment script - NOT loaded or run by the server.
 *
 *   node scripts/generate-descriptions.js
 *
 * Fills in `description` for any destination that doesn't have a real one
 * (empty, missing, or the "No description available." placeholder). Does
 * NOT touch `tags` - those are added by hand afterward.
 *
 * For each such destination:
 *   1. If it has a `placeId` and GOOGLE_PLACES_API_KEY is set, ask Google
 *      Place Details for its editorial summary and use that text AS-IS
 *      (it's Google's own short factual blurb, not a review) - marked
 *      `descriptionSource: "google"`.
 *   2. Otherwise (no editorial summary available - common, not an error),
 *      fall back to generating one sentence via OpenRouter, using only the
 *      facts already on the destination - marked
 *      `descriptionSource: "ai-generated"`.
 *   3. If neither works, the description is left empty and the place is
 *      listed in the "still need one" summary at the end - never a
 *      fabricated description.
 *
 * Safe to run with either or both of GOOGLE_PLACES_API_KEY /
 * OPENROUTER_API_KEY unset - it just skips the corresponding step for
 * every destination and leaves those descriptions as they are. Safe to
 * re-run - only touches destinations that still need a description.
 *
 * The prior data/db.json is backed up to
 * data/db.backup-before-descriptions.json before anything is written.
 */
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { readDB, writeDB, DB_FILE } = require('../src/utils/dataStore');
const { requestChatCompletion } = require('../src/services/aiSearch');

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_API_BASE = 'https://places.googleapis.com/v1';
// Next to whichever db.json is actually in use (DB_FILE is already
// resolved to an absolute path by dataStore.js) - not hardcoded to the
// real project data/ dir, so this stays correct under a test DB_FILE too.
const BACKUP_FILE = path.join(path.dirname(DB_FILE), 'db.backup-before-descriptions.json');

// Free-tier-friendly pacing: Google Places has no documented free-tier RPM
// limit as tight as OpenRouter's, but a small delay is still polite.
// OpenRouter's free tier is 20 requests/minute, so stay comfortably under
// one request per 3 seconds.
const GOOGLE_REQUEST_DELAY_MS = 200;
const OPENROUTER_REQUEST_DELAY_MS = 3500;

const PLACEHOLDER_DESCRIPTION = 'No description available.';

const DESCRIPTION_SYSTEM_PROMPT = 'Write ONE natural, concise sentence (under 25 words) describing this '
  + 'real business for a travel app, written for someone deciding whether to visit. ONLY use the facts '
  + 'given below - do not invent amenities, atmosphere details, menu items, or anything not explicitly '
  + 'stated. If the given facts are sparse, write a shorter, more general sentence rather than padding '
  + 'with invented specifics.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function needsDescription(destination) {
  const desc = destination.description;
  return !desc || !desc.trim() || desc.trim() === PLACEHOLDER_DESCRIPTION;
}

/** Google Place Details (New) - just the editorial summary field. Returns text or null. */
async function fetchGoogleEditorialSummary(placeId) {
  const res = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': 'editorialSummary' }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
  }

  const body = await res.json();
  const text = body.editorialSummary && body.editorialSummary.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

/** Builds the user message out of only the fields that actually have a value. */
function buildFactsMessage(destination) {
  const lines = [];
  if (destination.name) lines.push(`Name: ${destination.name}`);
  if (destination.category) lines.push(`Category: ${destination.category}`);
  if (destination.neighborhood) lines.push(`Neighborhood: ${destination.neighborhood}`);
  if (typeof destination.rating === 'number') lines.push(`Rating: ${destination.rating}`);
  if (typeof destination.priceLevel === 'number') lines.push(`Price level (1-4, higher = pricier): ${destination.priceLevel}`);
  return lines.join('\n');
}

async function generateAiDescription(destination) {
  const content = await requestChatCompletion(DESCRIPTION_SYSTEM_PROMPT, buildFactsMessage(destination));
  const sentence = content.trim();
  return sentence || null;
}

async function main() {
  if (!GOOGLE_API_KEY) {
    console.log('GOOGLE_PLACES_API_KEY is not set - skipping the Google editorial-summary step for every destination.');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('OPENROUTER_API_KEY is not set - skipping the AI-generated fallback for every destination.');
  }

  const db = await readDB();
  const candidates = db.destinations.filter(needsDescription);

  if (candidates.length === 0) {
    console.log('Every destination already has a real description. Nothing to do.');
    return;
  }

  console.log(`${candidates.length}/${db.destinations.length} destination(s) need a description.\n`);

  // Back up the current state before writing anything.
  await fs.copyFile(DB_FILE, BACKUP_FILE);
  console.log(`Backed up current data/db.json to ${path.relative(process.cwd(), BACKUP_FILE)}\n`);

  let googleCount = 0;
  let aiCount = 0;
  const stillEmpty = [];

  for (let i = 0; i < candidates.length; i++) {
    const destination = candidates[i];
    const progress = `[${i + 1}/${candidates.length}]`;

    let description = null;
    let source = null;

    if (destination.placeId && GOOGLE_API_KEY) {
      try {
        description = await fetchGoogleEditorialSummary(destination.placeId);
        await sleep(GOOGLE_REQUEST_DELAY_MS);
        if (description) source = 'google';
        else console.log(`${progress} ${destination.name} - no Google editorial summary available, trying AI`);
      } catch (err) {
        console.log(`${progress} ${destination.name} - Google Place Details error (${err.message}), trying AI`);
      }
    }

    if (!description) {
      try {
        description = await generateAiDescription(destination);
        await sleep(OPENROUTER_REQUEST_DELAY_MS);
        if (description) source = 'ai-generated';
      } catch (err) {
        // AI_UNAVAILABLE (no key, network/timeout error, rate limited, or
        // both models failed) - not fatal, just leave this one empty.
        console.log(`${progress} ${destination.name} - AI description unavailable (${err.message})`);
      }
    }

    if (description) {
      destination.description = description;
      destination.descriptionSource = source;
      // eslint-disable-next-line no-await-in-loop
      await writeDB(db);
      if (source === 'google') googleCount += 1;
      else aiCount += 1;
      console.log(`${progress} ${destination.name} - description set (${source})`);
    } else {
      destination.description = '';
      stillEmpty.push(destination.name);
      console.log(`${progress} ${destination.name} - still needs a description`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Google editorial summary: ${googleCount}`);
  console.log(`AI-generated:             ${aiCount}`);
  console.log(`Still empty:              ${stillEmpty.length}`);
  if (stillEmpty.length > 0) {
    console.log('\nDestinations that still need a description written by hand:');
    stillEmpty.forEach((name) => console.log(`  - ${name}`));
  }
}

main().catch((err) => {
  console.error('generate-descriptions.js failed:', err);
  process.exit(1);
});
