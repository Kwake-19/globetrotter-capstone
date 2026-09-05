const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

describe('Admin', () => {
  let app;
  let cleanup;
  let readDB;
  let writeDB;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
    // Grabbed AFTER createTestApp() (which calls jest.resetModules() and
    // re-requires everything) so this is the SAME dataStore module
    // instance the freshly-required admin routes are actually using -
    // requiring it any earlier would silently point at a stale, unused
    // module instance operating on a different DB_FILE.
    ({ readDB, writeDB } = require('../src/utils/dataStore'));
  });

  afterAll(() => {
    cleanup();
  });

  async function makeAdmin(userId) {
    const db = await readDB();
    const user = db.users.find((u) => u.id === userId);
    user.isAdmin = true;
    await writeDB(db);
  }

  describe('non-admin access is blocked', () => {
    it('returns 401 with no token at all', async () => {
      const res = await request(app).get('/api/admin/destinations');
      expect(res.status).toBe(401);
    });

    it('returns 403 for GET /api/admin/destinations', async () => {
      const { token } = await registerUser(app);
      const res = await request(app).get('/api/admin/destinations').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for POST /api/admin/destinations', async () => {
      const { token } = await registerUser(app);
      const res = await request(app)
        .post('/api/admin/destinations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'x', category: 'restaurant', neighborhood: 'x', latitude: 1, longitude: 1 });
      expect(res.status).toBe(403);
    });

    it('returns 403 for PUT /api/admin/destinations/:id', async () => {
      const { token } = await registerUser(app);
      const res = await request(app)
        .put('/api/admin/destinations/dest-001')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'x' });
      expect(res.status).toBe(403);
    });

    it('returns 403 for DELETE /api/admin/destinations/:id', async () => {
      const { token } = await registerUser(app);
      const res = await request(app).delete('/api/admin/destinations/dest-001').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('admin access', () => {
    it('can list every destination', async () => {
      const { token, user } = await registerUser(app);
      await makeAdmin(user.id);

      const res = await request(app).get('/api/admin/destinations').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results.length).toBe(res.body.count);
    });

    it('rejects creating a destination missing required fields with 400', async () => {
      const { token, user } = await registerUser(app);
      await makeAdmin(user.id);

      const res = await request(app)
        .post('/api/admin/destinations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Missing coordinates' });
      expect(res.status).toBe(400);
    });

    it('creates, updates, and deletes a destination end-to-end', async () => {
      const { token, user } = await registerUser(app);
      await makeAdmin(user.id);

      const createRes = await request(app)
        .post('/api/admin/destinations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Cafe',
          category: 'restaurant',
          neighborhood: 'Bastos',
          latitude: 3.88,
          longitude: 11.51,
          photos: ['/images/places/test-cafe-1.jpg', '/images/places/test-cafe-2.jpg']
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.id).toEqual(expect.any(String));
      // localImagePath is read-only, always derived from photos[0].
      expect(createRes.body.localImagePath).toBe('/images/places/test-cafe-1.jpg');
      const id = createRes.body.id;

      const publicList = await request(app).get('/api/destinations');
      expect(publicList.body.results.some((d) => d.id === id)).toBe(true);

      const updateRes = await request(app)
        .put(`/api/admin/destinations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Cafe Name', amenities: ['Free WiFi', 'Wheelchair accessible'] });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe('Updated Cafe Name');
      expect(updateRes.body.amenities).toEqual(['Free WiFi', 'Wheelchair accessible']);
      // Untouched fields survive a partial update.
      expect(updateRes.body.neighborhood).toBe('Bastos');

      const deleteRes = await request(app)
        .delete(`/api/admin/destinations/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(deleteRes.status).toBe(204);

      const publicListAfterDelete = await request(app).get('/api/destinations');
      expect(publicListAfterDelete.body.results.some((d) => d.id === id)).toBe(false);

      const adminListAfterDelete = await request(app)
        .get('/api/admin/destinations')
        .set('Authorization', `Bearer ${token}`);
      expect(adminListAfterDelete.body.results.some((d) => d.id === id)).toBe(false);
    });

    it('returns 404 when updating or deleting an unknown destination', async () => {
      const { token, user } = await registerUser(app);
      await makeAdmin(user.id);

      const putRes = await request(app)
        .put('/api/admin/destinations/does-not-exist')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'x' });
      expect(putRes.status).toBe(404);

      const deleteRes = await request(app)
        .delete('/api/admin/destinations/does-not-exist')
        .set('Authorization', `Bearer ${token}`);
      expect(deleteRes.status).toBe(404);
    });

    it('keeps localImagePath in sync when photos is updated', async () => {
      const { token, user } = await registerUser(app);
      await makeAdmin(user.id);

      const createRes = await request(app)
        .post('/api/admin/destinations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Sync Test', category: 'mall', neighborhood: 'Centre-ville', latitude: 3.87, longitude: 11.52 });
      expect(createRes.body.localImagePath).toBeNull();

      const updateRes = await request(app)
        .put(`/api/admin/destinations/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photos: ['/images/places/new-photo.jpg'] });
      expect(updateRes.body.localImagePath).toBe('/images/places/new-photo.jpg');

      const clearRes = await request(app)
        .put(`/api/admin/destinations/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photos: [] });
      expect(clearRes.body.localImagePath).toBeNull();
    });
  });
});
