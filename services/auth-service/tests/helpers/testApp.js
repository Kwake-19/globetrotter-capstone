const fs = require('fs');
const path = require('path');
const os = require('os');
const request = require('supertest');

/**
 * Every test file gets its OWN copy of the seed users DB, in a temp file -
 * same isolation pattern as the Phase 1 monolith's test helper.
 */
function createTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-prod';
  process.env.JWT_EXPIRES_IN = '1h';

  const seedPath = path.join(__dirname, '..', '..', 'data', 'users.json');
  const tmpPath = path.join(
    os.tmpdir(),
    `globetrotter-auth-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
