const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('Destinations', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => {
    cleanup();
  });

  it('lists all seeded destinations', async () => {
    const res = await request(app).get('/api/destinations');

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.results.length).toBe(res.body.count);
  });

  it('filters by category', async () => {
    const res = await request(app).get('/api/destinations?category=mall');

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    res.body.results.forEach((place) => {
      expect(place.category).toBe('mall');
    });
  });

  it('rejects an invalid category with 400', async () => {
    const res = await request(app).get('/api/destinations?category=spaceship');

    expect(res.status).toBe(400);
  });

  it('searches by free text across name, description and tags', async () => {
    const res = await request(app).get('/api/destinations?q=ice cream');

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('lists the six expected filter categories', async () => {
    const res = await request(app).get('/api/destinations/categories');

    expect(res.status).toBe(200);
    const ids = res.body.categories.map((c) => c.id);
    expect(ids).toEqual(['restaurant', 'ice_cream', 'mall', 'fun_place', 'hotel', 'petrol_station']);
  });

  it('filters by the new hotel and petrol_station categories', async () => {
    const hotels = await request(app).get('/api/destinations?category=hotel');
    expect(hotels.status).toBe(200);
    expect(hotels.body.results.length).toBeGreaterThanOrEqual(4);
    hotels.body.results.forEach((place) => expect(place.category).toBe('hotel'));

    const petrolStations = await request(app).get('/api/destinations?category=petrol_station');
    expect(petrolStations.status).toBe(200);
    expect(petrolStations.body.results.length).toBeGreaterThanOrEqual(4);
    petrolStations.body.results.forEach((place) => expect(place.category).toBe('petrol_station'));
  });

  it('fetches a single destination by id', async () => {
    const list = await request(app).get('/api/destinations');
    const firstId = list.body.results[0].id;

    const res = await request(app).get(`/api/destinations/${firstId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(firstId);
  });

  it('returns 404 for an unknown destination id', async () => {
    const res = await request(app).get('/api/destinations/does-not-exist');

    expect(res.status).toBe(404);
  });

  it('always includes placeId and localImagePath, as null or a string, never missing entirely', async () => {
    const list = await request(app).get('/api/destinations');
    expect(list.body.results.length).toBeGreaterThan(0);
    list.body.results.forEach((place) => {
      expect(place).toHaveProperty('placeId');
      expect(place).toHaveProperty('localImagePath');
      expect(place.placeId === null || typeof place.placeId === 'string').toBe(true);
      expect(place.localImagePath === null || typeof place.localImagePath === 'string').toBe(true);
    });

    const firstId = list.body.results[0].id;
    const single = await request(app).get(`/api/destinations/${firstId}`);
    expect(single.body).toHaveProperty('placeId');
    expect(single.body).toHaveProperty('localImagePath');
  });
});
