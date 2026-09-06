const fs = require('fs/promises');
const path = require('path');

// This service owns only the `itineraries` array.
const DB_FILE = path.resolve(process.cwd(), process.env.DB_FILE || './data/itineraries.json');

/**
 * Same JSON-file-plus-write-queue pattern as the Phase 1 monolith's
 * dataStore: reads just parse the file, writes are serialized through an
 * in-process queue and done via a temp file + rename.
 */
let writeQueue = Promise.resolve();

async function readDB() {
  const raw = await fs.readFile(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeDB(data) {
  writeQueue = writeQueue.then(async () => {
    const json = JSON.stringify(data, null, 2);
    const tmpFile = `${DB_FILE}.tmp`;
    await fs.writeFile(tmpFile, json, 'utf-8');
    await fs.rename(tmpFile, DB_FILE);
  });
  return writeQueue;
}

module.exports = { readDB, writeDB, DB_FILE };
