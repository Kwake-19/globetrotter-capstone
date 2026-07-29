const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

describe('Profile', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => {
    cleanup();
  });

  describe('GET /api/profile', () => {
    it('blocks unauthenticated access with 401', async () => {
      const res = await request(app).get('/api/profile');
      expect(res.status).toBe(401);
    });

    it('returns the current user without a passwordHash', async () => {
      const { token, user } = await registerUser(app, { name: 'Profile Person', phone: '699000000', homeCity: 'Bastos' });

      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.name).toBe('Profile Person');
      expect(res.body.phone).toBe('699000000');
      expect(res.body.homeCity).toBe('Bastos');
      expect(res.body.passwordHash).toBeUndefined();
    });
  });

  describe('PUT /api/profile', () => {
    it('blocks unauthenticated access with 401', async () => {
      const res = await request(app).put('/api/profile').send({ name: 'Nope' });
      expect(res.status).toBe(401);
    });

    it('updates name, phone and homeCity', async () => {
      const { token } = await registerUser(app);

      const res = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name', phone: '677111222', homeCity: 'Nlongkak' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.phone).toBe('677111222');
      expect(res.body.homeCity).toBe('Nlongkak');
    });

    it('rejects an empty name with 400', async () => {
      const { token } = await registerUser(app);

      const res = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' });

      expect(res.status).toBe(400);
    });

    it('does not change email or username via this endpoint', async () => {
      const { token, user } = await registerUser(app);

      const res = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Still Me', email: 'hacker@example.com', username: 'hacker' });

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(user.email);
      expect(res.body.username).toBe(user.username);
    });
  });
});
