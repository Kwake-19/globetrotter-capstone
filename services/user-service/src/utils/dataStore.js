const fs = require('fs/promises');
const path = require('path');

const DB_FILE = path.resolve(process.cwd(), process.env.DB_FILE || './data/db.json');

/**
 * Same JSON-file-plus-write-queue pattern as Phase 1's shared dataStore,
 * just scoped to this service's own file (data/db.json here holds only
 * `users` - no other service reads or writes this file).
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
