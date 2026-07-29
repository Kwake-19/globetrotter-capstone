const fs = require('fs/promises');
const path = require('path');

const DB_FILE = path.resolve(process.cwd(), process.env.DB_FILE || './data/db.json');

/**
 * Phase 1 deliberately stores everything in a single JSON file instead of a
 * real database (see the "Data Storage" challenge in the course slides).
 * Reads are cheap - just parse the file. Writes are more dangerous: if two
 * requests write at the same time, the second write can clobber the first
 * or corrupt the file. We fix that here with a tiny in-process write queue
 * so writes are always applied one at a time, in order.
 */
let writeQueue = Promise.resolve();

async function readDB() {
  const raw = await fs.readFile(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeDB(data) {
  // Chain onto the existing queue so this write waits for any write
  // already in progress to finish first.
  writeQueue = writeQueue.then(async () => {
    const json = JSON.stringify(data, null, 2);
    // Write to a temp file then rename, so a crash mid-write can never
    // leave db.json half-written / corrupted.
    const tmpFile = `${DB_FILE}.tmp`;
    await fs.writeFile(tmpFile, json, 'utf-8');
    await fs.rename(tmpFile, DB_FILE);
  });
  return writeQueue;
}

module.exports = { readDB, writeDB, DB_FILE };
