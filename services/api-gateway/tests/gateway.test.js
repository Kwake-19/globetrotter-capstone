const request = require('supertest');
const jwt = require('jsonwebtoken');

const SECRET = 'test-only-secret-do-not-use-in-prod';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = SECRET;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_MAPS_EMBED_KEY = 'test-maps-key';
process.env.AUTH_SERVICE_URL = 'http://auth-service:4001';
process.env.DESTINATIONS_SERVICE_URL = 'http://destinations-service:4002';
process.env.SEARCH_SERVICE_URL = 'http://search-service:4003';
process.env.ITINERARY_SERVICE_URL = 'http://itinerary-service:4004';
process.env.RECOMMENDATION_SERVICE_URL = 'http://recommendation-service:4005';
process.env.CHATBOT_SERVICE_URL = 'http://chatbot-service:4006';

const { createApp } = require('../src/app');

const app = createApp();

function token(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
}

/** A fetch() stub that always answers 200 with the given JSON and records the call. */
function stubFetchOk(body = { ok: true }) {
  return jest.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  );
}

/** The (url, init) the proxy passed to fetch on its most recent call. */
function lastFetchCall() {
  const [url, init] = global.fetch.mock.calls[global.fetch.mock.calls.length - 1];
  return { url, init };
}

afterEach(() => {
  delete global.fetch;
});

describe('gateway - own endpoints', () => {
  it('GET /api/health returns { status: ok, service: api-gateway }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'api-gateway' });
  });

  it('GET /api/config exposes only the frontend-facing keys', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      googleMapsEmbedKey: 'test-maps-key',
      googleClientId: 'test-client-id.apps.googleusercontent.com'
    });
  });

  it('unknown /api route is a JSON 404', async () => {
    global.fetch = stubFetchOk();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('gateway - proxying', () => {
  it('forwards a public GET to the right downstream service, path + query intact', async () => {
    global.fetch = stubFetchOk({ count: 0, results: [] });
    const res = await request(app).get('/api/destinations/nearby?lat=3.8&lng=11.5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, results: [] });
    const { url, init } = lastFetchCall();
    expect(url).toBe('http://destinations-service:4002/api/destinations/nearby?lat=3.8&lng=11.5');
    expect(init.method).toBe('GET');
  });

  it('routes /api/destinations/smart-search to search-service, not destinations-service', async () => {
    global.fetch = stubFetchOk({ results: [] });
    await request(app).get('/api/destinations/smart-search?q=cheap%20hotel');
    expect(lastFetchCall().url).toBe('http://search-service:4003/api/destinations/smart-search?q=cheap%20hotel');
  });

  it('routes /api/search to search-service', async () => {
    global.fetch = stubFetchOk({ results: [] });
    await request(app).get('/api/search?q=pizza');
    expect(lastFetchCall().url).toBe('http://search-service:4003/api/search?q=pizza');
  });

  it('returns 502 when the downstream connection fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/api/destinations');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Upstream service is unavailable' });
  });

  it('forwards the request body on a POST', async () => {
    global.fetch = stubFetchOk({ id: 'r1' });
    await request(app)
      .post('/api/destinations/dest-001/reviews')
      .set('Authorization', `Bearer ${token({ sub: 'u1', name: 'Amina' })}`)
      .send({ rating: 5, text: 'Great' });

    const { init } = lastFetchCall();
    expect(JSON.parse(Buffer.from(init.body).toString())).toEqual({ rating: 5, text: 'Great' });
  });
});

describe('gateway - identity forwarding', () => {
  it('turns a valid JWT into X-User-Id / X-User-Name headers downstream', async () => {
    global.fetch = stubFetchOk();
    await request(app)
      .get('/api/recommendations')
      .set('Authorization', `Bearer ${token({ sub: 'user-123', name: 'Amina Boula' })}`);

    const { init } = lastFetchCall();
    expect(init.headers['x-user-id']).toBe('user-123');
    expect(decodeURIComponent(init.headers['x-user-name'])).toBe('Amina Boula');
    expect(init.headers['x-is-admin']).toBeUndefined();
  });

  it('sends X-Is-Admin: true only for an admin token', async () => {
    global.fetch = stubFetchOk();
    await request(app)
      .get('/api/admin/destinations')
      .set('Authorization', `Bearer ${token({ sub: 'admin-1', name: 'Root', isAdmin: true })}`);

    expect(lastFetchCall().init.headers['x-is-admin']).toBe('true');
  });

  it('forwards no identity headers for a guest request', async () => {
    global.fetch = stubFetchOk();
    await request(app).get('/api/recommendations');

    const { init } = lastFetchCall();
    expect(init.headers['x-user-id']).toBeUndefined();
    expect(init.headers['x-user-name']).toBeUndefined();
    expect(init.headers['x-is-admin']).toBeUndefined();
  });

  it('strips a client-supplied X-User-Id (no spoofing the identity headers)', async () => {
    global.fetch = stubFetchOk();
    await request(app)
      .get('/api/recommendations')
      .set('X-User-Id', 'attacker')
      .set('X-Is-Admin', 'true');

    const { init } = lastFetchCall();
    expect(init.headers['x-user-id']).toBeUndefined();
    expect(init.headers['x-is-admin']).toBeUndefined();
  });

  it('ignores an invalid token and proceeds as guest', async () => {
    global.fetch = stubFetchOk();
    const res = await request(app).get('/api/recommendations').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(200);
    expect(lastFetchCall().init.headers['x-user-id']).toBeUndefined();
  });
});

describe('gateway - auth gates', () => {
  it('401s POST /api/itineraries with no token and never calls downstream', async () => {
    global.fetch = stubFetchOk();
    const res = await request(app).post('/api/itineraries').send({ title: 'Trip' });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('403s /api/admin for a non-admin token', async () => {
    global.fetch = stubFetchOk();
    const res = await request(app)
      .get('/api/admin/destinations')
      .set('Authorization', `Bearer ${token({ sub: 'u1', name: 'Amina' })}`);
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lets an admin token through to the admin routes', async () => {
    global.fetch = stubFetchOk({ count: 0, results: [] });
    const res = await request(app)
      .get('/api/admin/destinations')
      .set('Authorization', `Bearer ${token({ sub: 'admin-1', name: 'Root', isAdmin: true })}`);
    expect(res.status).toBe(200);
    expect(lastFetchCall().url).toBe('http://destinations-service:4002/api/admin/destinations');
  });

  it('allows a public GET /api/destinations with no token', async () => {
    global.fetch = stubFetchOk({ count: 0, results: [] });
    const res = await request(app).get('/api/destinations');
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('allows GET /api/shared/:id with no token', async () => {
    global.fetch = stubFetchOk({ title: 'Trip', items: [] });
    const res = await request(app).get('/api/shared/share-abc');
    expect(res.status).toBe(200);
    expect(lastFetchCall().url).toBe('http://itinerary-service:4004/api/shared/share-abc');
  });
});
