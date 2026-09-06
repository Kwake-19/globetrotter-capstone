/**
 * recommendation-service owns no data. It calls destinations-service and
 * itinerary-service over global fetch; per the Phase 2 brief both are
 * MOCKED here. installFetchMock() routes by URL:
 *   .../api/destinations  -> fixture catalog (or a failure)
 *   .../api/itineraries   -> the itineraries for the X-User-Id header
 */

process.env.NODE_ENV = 'test';
process.env.DESTINATIONS_SERVICE_URL = 'http://destinations-service:4002';
process.env.ITINERARY_SERVICE_URL = 'http://itinerary-service:4004';

const FIXTURE_DESTINATIONS = [
  { id: 'r1', name: 'Resto One', category: 'restaurant', rating: 4.8 },
  { id: 'r2', name: 'Resto Two', category: 'restaurant', rating: 4.2 },
  { id: 'h1', name: 'Hotel One', category: 'hotel', rating: 4.6 },
  { id: 'h2', name: 'Hotel Two', category: 'hotel', rating: 4.0 },
  { id: 'm1', name: 'Mall One', category: 'mall', rating: 4.5 },
  { id: 'f1', name: 'Fun One', category: 'fun_place', rating: 4.7 }
];

function createTestApp() {
  jest.resetModules();
  const { createApp } = require('../../src/app');
  return { app: createApp() };
}

/**
 * @param {object} opts
 * @param {Array|Error|number} opts.destinations
 * @param {Object<string,Array>|Error|number} opts.itinerariesByUser  map of X-User-Id -> itineraries
 */
function installFetchMock(opts = {}) {
  const { destinations = FIXTURE_DESTINATIONS, itinerariesByUser = {} } = opts;

  global.fetch = jest.fn(async (url, init) => {
    const u = String(url);

    if (u.includes('/api/destinations')) {
      if (destinations instanceof Error) throw destinations;
      if (typeof destinations === 'number') return new Response('{}', { status: destinations });
      return new Response(JSON.stringify({ count: destinations.length, results: destinations }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    if (u.includes('/api/itineraries')) {
      if (itinerariesByUser instanceof Error) throw itinerariesByUser;
      if (typeof itinerariesByUser === 'number') return new Response('{}', { status: itinerariesByUser });
      const userId = init && init.headers && init.headers['X-User-Id'];
      const list = itinerariesByUser[userId] || [];
      return new Response(JSON.stringify({ count: list.length, results: list }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    throw new Error(`unexpected fetch in test: ${u}`);
  });

  return global.fetch;
}

function clearFetchMock() {
  delete global.fetch;
}

module.exports = { createTestApp, installFetchMock, clearFetchMock, FIXTURE_DESTINATIONS };
