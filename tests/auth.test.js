const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

describe('Auth', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => {
    cleanup();
  });

  describe('POST /api/auth/register', () => {
    it('creates a new user and returns a token', async () => {
      const { res } = await registerUser(app, { email: 'amina@example.com', username: 'amina' });

      expect(res.status).toBe(201);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user.email).toBe('amina@example.com');
      expect(res.body.user.username).toBe('amina');
      // The password hash should never be sent back to the client.
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('rejects a duplicate email with 409', async () => {
      await registerUser(app, { email: 'duplicate@example.com' });
      const { res } = await registerUser(app, { email: 'duplicate@example.com' });

      expect(res.status).toBe(409);
    });

    it('rejects a duplicate username (case-insensitive) with 409', async () => {
      await registerUser(app, { username: 'DupeName' });
      const { res } = await registerUser(app, { username: 'dupename' });

      expect(res.status).toBe(409);
    });

    it('rejects a missing password with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'No Password', username: 'nopassuser', email: 'nopass@example.com' });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid email with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Bad Email', username: 'bademailuser', email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(400);
    });

    it('rejects a username shorter than 3 characters with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Short Username', username: 'ab', email: 'shortuser@example.com', password: 'password123' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with the email as the identifier', async () => {
      const { credentials } = await registerUser(app, { email: 'login-ok@example.com' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: credentials.email, password: credentials.password });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
    });

    it('logs in with the username as the identifier', async () => {
      const { credentials } = await registerUser(app, { username: 'loginusername' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'LoginUserName', password: credentials.password });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
    });

    it('rejects the wrong password with 401', async () => {
      const { credentials } = await registerUser(app, { email: 'login-bad@example.com' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: credentials.email, password: 'totally-wrong' });

      expect(res.status).toBe(401);
    });

    it('rejects an unknown identifier with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'nobody@example.com', password: 'whatever123' });

      expect(res.status).toBe(401);
    });
  });
});
