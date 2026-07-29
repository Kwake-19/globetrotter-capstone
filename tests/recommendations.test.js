const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

describe('Recommendations', () => {
  let app;
  let cleanup;
  let restaurantId;

  beforeAll(async () => {
    ({ app, cleanup } = createTestApp());
    const list = await request(app).get('/api/destinations?category=restaurant');
    restaurantId = list.body.results[0].id;
  });

  afterAll(() => {
    cleanup();
  });

  it('returns non-personalized results for a guest', async () => {
    const res = await request(app).get('/api/recommendations');

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(false);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('personalizes results once a user has an itinerary', async () => {
    const { token } = await registerUser(app);

    await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Food tour', items: [{ destinationId: restaurantId }] });

    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(true);
    expect(res.body.basedOnCategories).toContain('restaurant');
  });
});
