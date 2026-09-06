const request = require('supertest');
const { createTestApp, installFetchMock, clearFetchMock } = require('./helpers/testApp');

describe('GET /api/recommendations', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  afterEach(() => clearFetchMock());

  it('returns non-personalized results for a guest (no X-User-Id)', async () => {
    installFetchMock();
    const res = await request(app).get('/api/recommendations');

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(false);
    expect(res.body.results.length).toBeGreaterThan(0);
    // spread across categories, not all restaurants
    const categories = new Set(res.body.results.map((d) => d.category));
    expect(categories.size).toBeGreaterThan(1);
    // never fetched itineraries for a guest
    const calledItineraries = global.fetch.mock.calls.some(([u]) => String(u).includes('/api/itineraries'));
    expect(calledItineraries).toBe(false);
  });

  it('503s when destinations-service is unreachable', async () => {
    installFetchMock({ destinations: new Error('ECONNREFUSED') });
    const res = await request(app).get('/api/recommendations');
    expect(res.status).toBe(503);
  });

  it('personalizes once the user has an itinerary (basedOnCategories reflects it)', async () => {
    installFetchMock({
      itinerariesByUser: {
        'user-42': [
          { id: 'it1', userId: 'user-42', items: [{ destinationId: 'r1' }, { destinationId: 'r2' }] }
        ]
      }
    });

    const res = await request(app).get('/api/recommendations').set('X-User-Id', 'user-42');

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(true);
    expect(res.body.basedOnCategories).toContain('restaurant');
    // the two restaurants already in the itinerary are excluded from "new to you"
    expect(res.body.results.some((d) => d.id === 'r1' || d.id === 'r2')).toBe(false);
  });

  it('falls back to non-personalized when the user has no itineraries yet', async () => {
    installFetchMock({ itinerariesByUser: { 'user-99': [] } });
    const res = await request(app).get('/api/recommendations').set('X-User-Id', 'user-99');

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(false);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('degrades to non-personalized (still 200) when itinerary-service errors', async () => {
    installFetchMock({ itinerariesByUser: 500 });
    const res = await request(app).get('/api/recommendations').set('X-User-Id', 'user-42');

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(false);
  });

  it('respects the limit query param (capped at 18)', async () => {
    installFetchMock();
    const res = await request(app).get('/api/recommendations?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(3);
  });
});
