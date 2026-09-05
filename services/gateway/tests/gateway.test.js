const request = require('supertest');

process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const app = createApp();

describe('Gateway', () => {
  it('GET /api/health returns 200 and its own status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('gateway');
  });

  it('GET /api/config returns a googleMapsEmbedKey field', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('googleMapsEmbedKey');
  });

  it('serves the static frontend for /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
  });

  it('returns a JSON 404 for an unknown /api route', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('proxies /api/destinations to the Recommendation Service and surfaces 502 when it is unreachable', async () => {
    // No service is running at the default RECOMMENDATION_SERVICE_URL in
    // this test process, so the proxy should fail gracefully rather than
    // hang or crash the gateway.
    const res = await request(app).get('/api/destinations');
    expect(res.status).toBe(502);
  });
});
