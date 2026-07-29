const fs = require('fs');
const path = require('path');
const os = require('os');
const request = require('supertest');

/**
 * Every test file gets its OWN copy of the seed database, in a temp file.
 * That way tests can freely register users / create itineraries without
 * affecting other test files or the real data/db.json used for `npm run dev`.
 *
 * IMPORTANT: this must run (and env vars must be set) *before* `src/app.js`
 * is required for the first time, because src/utils/dataStore.js reads
 * process.env.DB_FILE once, at module-load time.
 */
function createTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-prod';
  process.env.JWT_EXPIRES_IN = '1h';

  const seedPath = path.join(__dirname, '..', '..', 'data', 'db.json');
  const tmpPath = path.join(
    os.tmpdir(),
    `globetrotter-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.copyFileSync(seedPath, tmpPath);
  process.env.DB_FILE = tmpPath;

  // jest.resetModules() clears the require cache so dataStore.js re-reads
  // process.env.DB_FILE for THIS test file instead of reusing whatever an
  // earlier test file's app.js pulled in.
  jest.resetModules();
  const { createApp } = require('../../src/app');
  const app = createApp();

  return {
    app,
    cleanup: () => fs.rmSync(tmpPath, { force: true })
  };
}

let userCounter = 0;

/** Registers a brand-new user against the given app and returns their token + id. */
async function registerUser(app, overrides = {}) {
  userCounter += 1;
  const payload = {
    name: `Test User ${userCounter}`,
    username: `testuser${userCounter}${Date.now()}`,
    email: `test-user-${userCounter}-${Date.now()}@example.com`,
    password: 'password123',
    phone: '',
    homeCity: '',
    ...overrides
  };

  const res = await request(app).post('/api/auth/register').send(payload);
  return { res, token: res.body.token, user: res.body.user, credentials: payload };
}

module.exports = { createTestApp, registerUser };
