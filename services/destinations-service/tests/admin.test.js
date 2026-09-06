const request = require('supertest');
const { createTestApp, asUser, asAdmin } = require('./helpers/testApp');

/**
 * The gateway gates /api/admin behind an admin token and forwards
 * X-Is-Admin: true. These tests hit the service directly, so they send
 * that header (asAdmin) or omit it (asUser / no headers).
 */
describe('Admin', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  describe('non-admin access is blocked', () => {
    it('returns 401 with no identity headers at all', async () => {
      const res = await request(app).get('/api/admin/destinations');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin user', async () => {
      const res = await request(app).get('/api/admin/destinations').set(asUser().headers);
      expect(res.status).toBe(403);
    });

    it('returns 403 for POST as a non-admin', async () => {
      const res = await request(app)
        .post('/api/admin/destinations')
        .set(asUser().headers)
        .send({ name: 'x', category: 'restaurant', neighborhood: 'x', latitude: 1, longitude: 1 });
      expect(res.status).toBe(403);
    });

    it('returns 403 for PUT as a non-admin', async () => {
      const res = await request(app)
        .put('/api/admin/destinations/dest-001')
        .set(asUser().headers)
        .send({ name: 'x' });
      expect(res.status).toBe(403);
    });

    it('returns 403 for DELETE as a non-admin', async () => {
      const res = await request(app).delete('/api/admin/destinations/dest-001').set(asUser().headers);
      expect(res.status).toBe(403);
    });
  });

  describe('admin access', () => {
    const admin = asAdmin();

    it('can list every destination', async () => {
      const res = await request(app).get('/api/admin/destinations').set(admin.headers);
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results.length).toBe(res.body.count);
    });

    it('rejects creating a destination missing required fields with 400', async () => {
      const res = await request(app)
        .post('/api/admin/destinations')
        .set(admin.headers)
        .send({ name: 'Missing coordinates' });
      expect(res.status).toBe(400);
    });

    it('creates, updates, and deletes a destination end-to-end', async () => {
      const createRes = await request(app)
        .post('/api/admin/destinations')
        .set(admin.headers)
        .send({
          name: 'Test Cafe',
          category: 'restaurant',
          neighborhood: 'Bastos',
          latitude: 3.88,
          longitude: 11.51,
          photos: ['/images/places/test-cafe-1.jpg', '/images/places/test-cafe-2.jpg']
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.localImagePath).toBe('/images/places/test-cafe-1.jpg');
      const { id } = createRes.body;

      const publicList = await request(app).get('/api/destinations');
      expect(publicList.body.results.some((d) => d.id === id)).toBe(true);

      const updateRes = await request(app)
        .put(`/api/admin/destinations/${id}`)
        .set(admin.headers)
        .send({ name: 'Updated Cafe Name', amenities: ['Free WiFi', 'Wheelchair accessible'] });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe('Updated Cafe Name');
      expect(updateRes.body.amenities).toEqual(['Free WiFi', 'Wheelchair accessible']);
      expect(updateRes.body.neighborhood).toBe('Bastos');

      const deleteRes = await request(app).delete(`/api/admin/destinations/${id}`).set(admin.headers);
      expect(deleteRes.status).toBe(204);

      const publicListAfterDelete = await request(app).get('/api/destinations');
      expect(publicListAfterDelete.body.results.some((d) => d.id === id)).toBe(false);
    });

    it('returns 404 when updating or deleting an unknown destination', async () => {
      const putRes = await request(app)
        .put('/api/admin/destinations/does-not-exist')
        .set(admin.headers)
        .send({ name: 'x' });
      expect(putRes.status).toBe(404);

      const deleteRes = await request(app).delete('/api/admin/destinations/does-not-exist').set(admin.headers);
      expect(deleteRes.status).toBe(404);
    });

    it('keeps localImagePath in sync when photos is updated', async () => {
      const createRes = await request(app)
        .post('/api/admin/destinations')
        .set(admin.headers)
        .send({ name: 'Sync Test', category: 'mall', neighborhood: 'Centre-ville', latitude: 3.87, longitude: 11.52 });
      expect(createRes.body.localImagePath).toBeNull();

      const updateRes = await request(app)
        .put(`/api/admin/destinations/${createRes.body.id}`)
        .set(admin.headers)
        .send({ photos: ['/images/places/new-photo.jpg'] });
      expect(updateRes.body.localImagePath).toBe('/images/places/new-photo.jpg');

      const clearRes = await request(app)
        .put(`/api/admin/destinations/${createRes.body.id}`)
        .set(admin.headers)
        .send({ photos: [] });
      expect(clearRes.body.localImagePath).toBeNull();
    });
  });
});
