const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

// Never call real Google servers in tests - replace the OAuth2Client
// constructor with one whose verifyIdToken is a jest.fn() we control from
// each test. The same mock function is reused across every `new
// OAuth2Client(...)` call the route makes (it's captured in the factory's
// closure), so tests can just call mockVerifyIdToken.mockResolvedValueOnce(...)
// / mockRejectedValueOnce(...) without needing to reach into route internals.
jest.mock('google-auth-library', () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
    __mockVerifyIdToken: verifyIdToken
  };
});

/** Shapes a fetch-like resolved verifyIdToken() result for a given Google payload. */
function googleTicket(payload) {
  return { getPayload: () => payload };
}

describe('Google Sign-In', () => {
  let app;
  let cleanup;
  let originalClientId;
  let mockVerifyIdToken;

  beforeAll(() => {
    // createTestApp() calls jest.resetModules() before requiring src/app,
    // which re-runs the jest.mock('google-auth-library', ...) factory
    // above and produces a NEW verifyIdToken mock function. Grabbing the
    // reference only AFTER createTestApp() has run ensures it's the same
    // instance the freshly-required auth.routes.js is actually calling -
    // grabbing it beforehand (module-scope, before this file's requires
    // run relative to resetModules) would silently mock a stale, unused
    // instance and every route call would hit a real, unconfigured mock.
    ({ app, cleanup } = createTestApp());
    ({ __mockVerifyIdToken: mockVerifyIdToken } = require('google-auth-library'));
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    originalClientId = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    mockVerifyIdToken.mockReset();
  });

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  describe('POST /api/auth/google', () => {
    it('rejects a missing idToken with 400', async () => {
      const res = await request(app).post('/api/auth/google').send({});
      expect(res.status).toBe(400);
    });

    it('returns 503 when GOOGLE_CLIENT_ID is not configured on the server', async () => {
      delete process.env.GOOGLE_CLIENT_ID;

      const res = await request(app).post('/api/auth/google').send({ idToken: 'whatever' });

      expect(res.status).toBe(503);
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects an invalid/unverifiable token with 401 and never trusts it', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Wrong recipient, payload audience != requiredAudience'));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'forged-token' });

      expect(res.status).toBe(401);
    });

    it('creates a new user from a first-time Google sign-in', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({
        sub: 'google-sub-new-1',
        email: 'brandnew@example.com',
        name: 'Brand New',
        email_verified: true
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

      expect(res.status).toBe(201);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user.email).toBe('brandnew@example.com');
      expect(res.body.user.name).toBe('Brand New');
      expect(res.body.user.authProvider).toBe('google');
      expect(res.body.user.googleId).toBe('google-sub-new-1');
      expect(res.body.user.username).toBe('brandnew');
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('auto-generates a de-duplicated username when the email local part is already taken', async () => {
      await registerUser(app, { username: 'taken', email: 'unrelated@example.com' });

      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({
        sub: 'google-sub-dupe-username',
        email: 'taken@example.com',
        name: 'Taken Person'
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe('taken2');
    });

    it('logs in an existing email/password user via Google and attaches their Google sub', async () => {
      const { credentials } = await registerUser(app, { email: 'existing-user@example.com' });

      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({
        sub: 'google-sub-existing-1',
        email: 'existing-user@example.com',
        name: 'Existing User'
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user.email).toBe('existing-user@example.com');
      expect(res.body.user.googleId).toBe('google-sub-existing-1');
      // Still the same account, not a duplicate - and the original password
      // login must keep working since this account isn't Google-only.
      const passwordLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: credentials.email, password: credentials.password });
      expect(passwordLogin.status).toBe(200);
      expect(passwordLogin.body.user.id).toBe(res.body.user.id);
    });

    it('logs in a returning Google user by sub on a second sign-in', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({
        sub: 'google-sub-returning-1',
        email: 'returning@example.com',
        name: 'Returning Person'
      }));
      const first = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });
      expect(first.status).toBe(201);

      // Second sign-in, same sub - even if Google's profile name changed,
      // matching by sub should find the SAME account, not create another.
      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({
        sub: 'google-sub-returning-1',
        email: 'returning@example.com',
        name: 'Returning Person (updated name)'
      }));
      const second = await request(app).post('/api/auth/google').send({ idToken: 'valid-token-2' });

      expect(second.status).toBe(200);
      expect(second.body.user.id).toBe(first.body.user.id);
    });

    it('rejects a token payload with no email with 401', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({ sub: 'google-sub-no-email' }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/login on a Google-only account', () => {
    it('returns a clear error instead of a generic invalid-credentials message', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(googleTicket({
        sub: 'google-sub-only-1',
        email: 'google-only@example.com',
        name: 'Google Only'
      }));
      await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'google-only@example.com', password: 'anything123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('This account uses Google Sign-In. Please use the Google button to log in.');
    });
  });
});
