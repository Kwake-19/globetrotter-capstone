const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('itinerary-service health', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  it('GET /api/health returns { status: ok, service: itinerary-service }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'itinerary-service' });
  });
});
