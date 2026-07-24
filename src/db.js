const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SEED_PATH = path.join(__dirname, '..', 'data', 'seed.json');

function getDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');
}

function ensureDb() {
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) return;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const initial = { users: [], destinations: seed.destinations, itineraries: [] };
  fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(getDbPath(), 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(getDbPath(), JSON.stringify(data, null, 2));
}

function getUsers() {
  return readDb().users;
}

function getUserByUsername(username) {
  return getUsers().find((u) => u.username === username) || null;
}

function saveUser(user) {
  const db = readDb();
  db.users.push(user);
  writeDb(db);
  return user;
}

function getDestinations() {
  return readDb().destinations;
}

function getDestinationById(id) {
  return getDestinations().find((d) => d.id === id) || null;
}

function getItineraries() {
  return readDb().itineraries;
}

function getItinerariesForUser(username) {
  return getItineraries().filter((i) => i.username === username);
}

function getItineraryById(id) {
  return getItineraries().find((i) => i.id === id) || null;
}

function saveItinerary(itinerary) {
  const db = readDb();
  db.itineraries.push(itinerary);
  writeDb(db);
  return itinerary;
}

function updateItinerary(id, updates) {
  const db = readDb();
  const idx = db.itineraries.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  db.itineraries[idx] = { ...db.itineraries[idx], ...updates };
  writeDb(db);
  return db.itineraries[idx];
}

function getItineraryByShareToken(shareToken) {
  return getItineraries().find((i) => i.shareToken === shareToken) || null;
}

module.exports = {
  uuidv4,
  getUsers,
  getUserByUsername,
  saveUser,
  getDestinations,
  getDestinationById,
  getItineraries,
  getItinerariesForUser,
  getItineraryById,
  saveItinerary,
  updateItinerary,
  getItineraryByShareToken,
};
