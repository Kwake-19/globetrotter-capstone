/**
 * One-off, manual migration - NOT run by the server.
 *
 *   node scripts/migrate-destination-schema.js
 *
 * Adds the new optional, admin-manageable destination fields (phone,
 * website, openingHours, amenities) where missing, and migrates the old
 * single `localImagePath` into a `photos` array - `localImagePath` is
 * kept afterward as a read-only convenience field for existing frontend
 * code (public/js/api.js's renderPlaceImage), always equal to
 * `photos[0]`. Going forward, src/routes/admin.routes.js keeps the two
 * in sync on every write; this script only handles the one-time backfill
 * for destinations that predate the `photos` field.
 *
 * Safe to re-run - only touches destinations that don't have a `photos`
 * array yet. Backs up the prior data/db.json to
 * data/db.backup-before-schema-migration.json before writing.
 */
const fs = require('fs/promises');
const path = require('path');
const { readDB, writeDB, DB_FILE } = require('../src/utils/dataStore');

const BACKUP_FILE = path.join(path.dirname(DB_FILE), 'db.backup-before-schema-migration.json');

async function main() {
  const db = await readDB();
  const candidates = db.destinations.filter((d) => !Array.isArray(d.photos));

  if (candidates.length === 0) {
    console.log('Every destination already has the new schema fields. Nothing to do.');
    return;
  }

  await fs.copyFile(DB_FILE, BACKUP_FILE);
  console.log(`Backed up current db.json to ${path.relative(process.cwd(), BACKUP_FILE)}`);

  candidates.forEach((d) => {
    d.photos = d.localImagePath ? [d.localImagePath] : [];
    d.localImagePath = d.photos[0] || null;
    if (d.phone === undefined) d.phone = null;
    if (d.website === undefined) d.website = null;
    if (d.openingHours === undefined) d.openingHours = null;
    if (!Array.isArray(d.amenities)) d.amenities = [];
  });

  await writeDB(db);
  console.log(`Migrated ${candidates.length}/${db.destinations.length} destination(s).`);
}

main().catch((err) => {
  console.error('migrate-destination-schema.js failed:', err);
  process.exit(1);
});
