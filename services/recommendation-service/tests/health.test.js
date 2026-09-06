const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('recommendation-service health', () => {
  it('GET /api/health returns { status: ok, service: recommendation-service }', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'recommendation-service' });
  });
});
