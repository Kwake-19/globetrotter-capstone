const request = require('supertest');
const { createTestApp, fakeUser } = require('./helpers/testApp');

describe('Recommendations', () => {
  let app;
  let cleanup;
  let mockUserItineraries;
  let restaurantId;

  beforeAll(async () => {
    ({ app, cleanup, mockUserItineraries } = await createTestApp());
    const list = await request(app).get('/api/destinations?category=restaurant');
    restaurantId = list.body.results[0].id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it('returns non-personalized results for a guest', async () => {
    const res = await request(app).get('/api/recommendations');

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(false);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('personalizes results based on the itineraries reported by the Itinerary Service', async () => {
    const { token } = fakeUser();
    mockUserItineraries(token, [
      { id: 'it-1', userId: 'whoever', title: 'Food tour', items: [{ destinationId: restaurantId }] }
    ]);

    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(true);
    expect(res.body.basedOnCategories).toContain('restaurant');
  });

  it('falls back to non-personalized results if the Itinerary Service is unreachable', async () => {
    const { token } = fakeUser();
    // No stub registered for this token - the Itinerary Service stub returns a 500.

    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(false);
    expect(res.body.results.length).toBeGreaterThan(0);
  });
});
