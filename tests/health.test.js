const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

// This is the simplest possible test: hit an endpoint, check the response.
// Every test below follows the same three-step shape (Arrange, Act, Assert):
//   1. Arrange - set up anything the test needs
//   2. Act     - make the request
//   3. Assert  - check the response is what we expect

describe('GET /api/health', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => {
    cleanup();
  });

  it('returns 200 and a status of ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
