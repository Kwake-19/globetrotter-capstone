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

  it('searches by free text matching a destination name', async () => {
    const list = await request(app).get('/api/destinations');
    const sample = list.body.results[0];
    const term = sample.name.split(' ')[0];

    const res = await request(app).get(`/api/destinations?q=${encodeURIComponent(term)}`);

    expect(res.status).toBe(200);
    expect(res.body.results.some((p) => p.id === sample.id)).toBe(true);
  });

  it('lists the six expected filter categories', async () => {
    const res = await request(app).get('/api/destinations/categories');

    expect(res.status).toBe(200);
    const ids = res.body.categories.map((c) => c.id);
    expect(ids).toEqual(['restaurant', 'ice_cream', 'mall', 'fun_place', 'hotel', 'petrol_station']);
  });

  it('filters by the hotel and petrol_station categories', async () => {
    const hotels = await request(app).get('/api/destinations?category=hotel');
    expect(hotels.status).toBe(200);
    expect(hotels.body.results.length).toBeGreaterThan(0);
    hotels.body.results.forEach((place) => expect(place.category).toBe('hotel'));

    const petrolStations = await request(app).get('/api/destinations?category=petrol_station');
    expect(petrolStations.status).toBe(200);
    expect(petrolStations.body.results.length).toBeGreaterThan(0);
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

  describe('GET /api/destinations/nearby', () => {
    // Roughly Bastos, Yaounde - close to a dense cluster of seeded places.
    const BASTOS_LAT = 3.8878;
    const BASTOS_LNG = 11.5085;

    it('rejects a request with missing coordinates with 400', async () => {
      const res = await request(app).get('/api/destinations/nearby');
      expect(res.status).toBe(400);
    });

    it('rejects non-numeric coordinates with 400', async () => {
      const res = await request(app).get('/api/destinations/nearby?lat=not-a-number&lng=11.5');
      expect(res.status).toBe(400);
    });

    it('returns results sorted by distance ascending, each with a distanceKm field', async () => {
      const res = await request(app).get(`/api/destinations/nearby?lat=${BASTOS_LAT}&lng=${BASTOS_LNG}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(1);
      res.body.results.forEach((place) => {
        expect(typeof place.distanceKm).toBe('number');
      });
      for (let i = 1; i < res.body.results.length; i++) {
        expect(res.body.results[i].distanceKm).toBeGreaterThanOrEqual(res.body.results[i - 1].distanceKm);
      }
    });

    it('excludes places outside radiusKm and includes them once the radius is widened', async () => {
      // "Eco Park" is ~11.5km from this point - outside the default 10km
      // radius but inside a 25km one.
      const defaultRadius = await request(app).get(`/api/destinations/nearby?lat=${BASTOS_LAT}&lng=${BASTOS_LNG}`);
      expect(defaultRadius.status).toBe(200);
      expect(defaultRadius.body.results.some((p) => p.name === 'Eco Park')).toBe(false);
      defaultRadius.body.results.forEach((place) => expect(place.distanceKm).toBeLessThanOrEqual(10));

      const widerRadius = await request(app)
        .get(`/api/destinations/nearby?lat=${BASTOS_LAT}&lng=${BASTOS_LNG}&radiusKm=25`);
      expect(widerRadius.status).toBe(200);
      expect(widerRadius.body.results.some((p) => p.name === 'Eco Park')).toBe(true);
    });

    it('rejects a non-positive radiusKm with 400', async () => {
      const res = await request(app).get(`/api/destinations/nearby?lat=${BASTOS_LAT}&lng=${BASTOS_LNG}&radiusKm=-5`);
      expect(res.status).toBe(400);
    });

    it('optionally filters by category', async () => {
      const res = await request(app)
        .get(`/api/destinations/nearby?lat=${BASTOS_LAT}&lng=${BASTOS_LNG}&radiusKm=25&category=hotel`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      res.body.results.forEach((place) => expect(place.category).toBe('hotel'));
    });

    it('rejects an invalid category with 400', async () => {
      const res = await request(app)
        .get(`/api/destinations/nearby?lat=${BASTOS_LAT}&lng=${BASTOS_LNG}&category=spaceship`);
      expect(res.status).toBe(400);
    });
  });
});
