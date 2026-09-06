const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Every test file gets its OWN temp copy of the seed itineraries DB.
 *
 * itinerary-service calls destinations-service over global fetch to
 * validate destinationIds and to enrich the shared view; per the Phase 2
 * brief that call is MOCKED here. installFetchMock() answers
 * GET .../api/destinations with a small fixture catalog (or a failure).
 */
const FIXTURE_DESTINATIONS = [
  { id: 'dest-001', name: 'Seven Hills', category: 'restaurant', neighborhood: 'Bastos' },
  { id: 'dest-002', name: 'Hilton Yaounde', category: 'hotel', neighborhood: 'Centre-ville' },
  { id: 'dest-003', name: 'Playce Warda', category: 'mall', neighborhood: 'Warda' }
];

function createTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.DESTINATIONS_SERVICE_URL = 'http://destinations-service:4002';

  const seedPath = path.join(__dirname, '..', '..', 'data', 'itineraries.json');
  const tmpPath = path.join(
    os.tmpdir(),
    `globetrotter-itinerary-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

/**
 * @param {Array|Error|number} destinations  fixture list (default), an Error to reject with,
 *                                            or an HTTP status number to fail the call with
 */
function installFetchMock(destinations = FIXTURE_DESTINATIONS) {
  global.fetch = jest.fn(async (url) => {
    if (!String(url).includes('/api/destinations')) {
      throw new Error(`unexpected fetch in test: ${url}`);
    }
    if (destinations instanceof Error) throw destinations;
    if (typeof destinations === 'number') {
      return new Response(JSON.stringify({ error: 'boom' }), { status: destinations });
    }
    return new Response(
      JSON.stringify({ count: destinations.length, results: destinations }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
  return global.fetch;
}

function clearFetchMock() {
  delete global.fetch;
}

let userCounter = 0;
function asUser() {
  userCounter += 1;
  const id = `user-${userCounter}-${Date.now()}`;
  return { id, headers: { 'X-User-Id': id } };
}

module.exports = { createTestApp, installFetchMock, clearFetchMock, asUser, FIXTURE_DESTINATIONS };
