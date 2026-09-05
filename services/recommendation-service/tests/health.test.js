const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('GET /api/health', () => {
  let app;
  let cleanup;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    await cleanup();
  });

  it('returns 200 and a status of ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('recommendation-service');
  });
});
