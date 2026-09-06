const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Every test file gets its OWN copy of the seed destinations DB, in a temp
 * file - same isolation pattern as the Phase 1 monolith's test helper.
 *
 * There is no users table in this service, so tests simulate an
 * authenticated caller by sending the same identity headers the gateway
 * would forward: X-User-Id, and (for review writes) X-User-Name /
 * X-Is-Admin. asUser() / asAdmin() build those header bags.
 */
function createTestApp() {
  process.env.NODE_ENV = 'test';

  const seedPath = path.join(__dirname, '..', '..', 'data', 'destinations.json');
  const tmpPath = path.join(
    os.tmpdir(),
    `globetrotter-destinations-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.copyFileSync(seedPath, tmpPath);
  process.env.DB_FILE = tmpPath;

  jest.resetModules();
  const { createApp } = require('../../src/app');
  const app = createApp();

  return {
    app,
    cleanup: () => fs.rmSync(tmpPath, { force: true })
  };
}

let userCounter = 0;

function asUser(overrides = {}) {
  userCounter += 1;
  const id = overrides.id || `user-${userCounter}-${Date.now()}`;
  const name = overrides.name || `Test User ${userCounter}`;
  const headers = { 'X-User-Id': id, 'X-User-Name': encodeURIComponent(name) };
  if (overrides.isAdmin) headers['X-Is-Admin'] = 'true';
  return { id, name, headers };
}

function asAdmin(overrides = {}) {
  return asUser({ ...overrides, isAdmin: true });
}

module.exports = { createTestApp, asUser, asAdmin };
