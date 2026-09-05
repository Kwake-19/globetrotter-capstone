const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const jwt = require('jsonwebtoken');

/**
 * A real (but tiny, in-process) HTTP server standing in for the Itinerary
 * Service - fetch-mocking libraries (nock, undici's MockAgent) don't
 * reliably intercept global fetch under Jest's node test environment, so a
 * real server on an ephemeral localhost port is used instead. `responses`
 * maps an `Authorization` header value to the itineraries that token
 * should get back; a token with no entry gets a 500, simulating the
 * Itinerary Service being unavailable/erroring.
 */
function startItineraryServiceStub(responses) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/itineraries') {
        const itineraries = responses.get(req.headers.authorization);
        if (itineraries) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: itineraries.length, results: itineraries }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'boom' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Every test file gets its own temp copy of the seed destinations DB and
 * its own stub server. Recommendation Service verifies JWTs locally (same
 * shared secret as user-service, no round trip needed), so tests can mint
 * a token directly with makeToken() instead of registering a real user.
 */
async function createTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-prod';
  process.env.RABBITMQ_URL = 'amqp://127.0.0.1:1'; // deliberately unreachable in tests; consumer isn't started

  const responses = new Map();
  const itineraryServer = await startItineraryServiceStub(responses);
  const { port } = itineraryServer.address();
  process.env.ITINERARY_SERVICE_URL = `http://127.0.0.1:${port}`;

  const seedPath = path.join(__dirname, '..', '..', 'data', 'db.json');
  const tmpPath = path.join(
    os.tmpdir(),
    `globetrotter-recommendation-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
      itineraryServer.close(resolve);
    }),
    /** Stubs Itinerary Service's GET /api/itineraries for the given token. */
    mockUserItineraries: (token, itineraries) => responses.set(`Bearer ${token}`, itineraries)
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

function fakeUser() {
  userCounter += 1;
  const user = { id: `user-${userCounter}-${Date.now()}`, name: `Test User ${userCounter}`, email: `test${userCounter}@example.com` };
  return { user, token: makeToken(user) };
}

module.exports = { createTestApp, fakeUser };
