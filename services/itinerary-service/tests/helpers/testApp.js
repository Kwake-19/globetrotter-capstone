const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const jwt = require('jsonwebtoken');

// A tiny fixture standing in for the Recommendation Service's destinations -
// this service only cares about `id` (for validation) and passes the rest
// through untouched when enriching a shared itinerary.
const FIXTURE_DESTINATIONS = [
  { id: 'dest-1', name: 'Test Restaurant', category: 'restaurant', rating: 4.5 },
  { id: 'dest-2', name: 'Test Mall', category: 'mall', rating: 4.2 }
];

/**
 * A real (but tiny, in-process) HTTP server standing in for the
 * Recommendation Service - fetch-mocking libraries (nock, undici's
 * MockAgent) don't reliably intercept global fetch under Jest's node test
 * environment, since it isolates globals per test file from the process
 * global undici relies on for its dispatcher symbol. A real server on an
 * ephemeral localhost port sidesteps that entirely.
 */
function startRecommendationServiceStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/destinations') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: FIXTURE_DESTINATIONS.length, results: FIXTURE_DESTINATIONS }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Every test file gets its own temp copy of the seed itineraries DB and its own stub server. */
async function createTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-prod';
  process.env.RABBITMQ_URL = 'amqp://127.0.0.1:1'; // deliberately unreachable - publishing is best-effort

  const recommendationServer = await startRecommendationServiceStub();
  const { port } = recommendationServer.address();
  process.env.RECOMMENDATION_SERVICE_URL = `http://127.0.0.1:${port}`;

  const seedPath = path.join(__dirname, '..', '..', 'data', 'db.json');
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
    cleanup: () => new Promise((resolve) => {
      fs.rmSync(tmpPath, { force: true });
      recommendationServer.close(resolve);
    })
  };
}

function makeToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let userCounter = 0;

/** Itinerary Service trusts the JWT alone - no user-service round trip - so "registering" here just mints a token for a fresh fake user id. */
function fakeUser() {
  userCounter += 1;
  const user = { id: `user-${userCounter}-${Date.now()}`, name: `Test User ${userCounter}`, email: `test${userCounter}@example.com` };
  return { user, token: makeToken(user) };
}

module.exports = { createTestApp, fakeUser, FIXTURE_DESTINATIONS };
