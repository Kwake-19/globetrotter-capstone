const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

/**
 * In Phase 2 the gateway has already verified the JWT and passes the user
 * id down as the X-User-Id header, so these tests send that header
 * directly instead of an Authorization bearer token.
 */
describe('Profile', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  it('401s without an X-User-Id header', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid X-User-Id', async () => {
    const { user } = await registerUser(app, { name: 'Amina Boula' });

    const res = await request(app).get('/api/profile').set('X-User-Id', user.id);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.name).toBe('Amina Boula');
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('404s for an X-User-Id that does not match any user', async () => {
    const res = await request(app).get('/api/profile').set('X-User-Id', 'ghost-user');
    expect(res.status).toBe(404);
  });

  it('updates name / phone / homeCity', async () => {
    const { user } = await registerUser(app);

    const res = await request(app)
      .put('/api/profile')
      .set('X-User-Id', user.id)
      .send({ name: 'New Name', phone: '+237 600 000 000', homeCity: 'Douala' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.phone).toBe('+237 600 000 000');
    expect(res.body.homeCity).toBe('Douala');
  });

  it('rejects an empty name on update with 400', async () => {
    const { user } = await registerUser(app);
    const res = await request(app)
      .put('/api/profile')
      .set('X-User-Id', user.id)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });
});
