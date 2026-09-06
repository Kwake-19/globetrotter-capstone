const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('auth-service health', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  it('GET /api/health returns { status: ok, service: auth-service }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'auth-service' });
  });
});
