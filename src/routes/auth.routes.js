const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const { readDB, writeDB } = require('../utils/dataStore');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
  return typeof username === 'string' && username.trim().length >= 3 && username.trim().length <= 30;
}

// "Remember me" doesn't add server-side sessions/refresh tokens (this app
// is stateless JWT-only) - it just issues a longer-lived token when asked,
// and the frontend chooses where to store it (localStorage, so it survives
// closing the browser, vs sessionStorage otherwise) to match. See
// public/js/api.js's setAuth/getToken.
function signToken(user, rememberMe) {
  const expiresIn = rememberMe
    ? (process.env.JWT_REMEMBER_EXPIRES_IN || '30d')
    : (process.env.JWT_EXPIRES_IN || '7d');
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user; // eslint-disable-line no-unused-vars
  return publicUser;
}

/**
 * Builds a username from the local part of an email (e.g. "amina" from
 * "amina@example.com"), falling back to "user" if that leaves nothing
 * usable, then de-dupes against existing usernames with a numeric suffix.
 */
function generateUsernameFromEmail(email, existingUsernamesLower) {
  const localPart = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const base = localPart.length >= 3 ? localPart : 'user';

  let candidate = base;
  let suffix = 1;
  while (existingUsernamesLower.has(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, username, email, password, phone, homeCity, rememberMe } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'username is required and must be 3-30 characters' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'a valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const db = await readDB();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();

    const existingEmail = db.users.find((u) => u.email === normalizedEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const existingUsername = db.users.find((u) => u.username.toLowerCase() === normalizedUsername);
    if (existingUsername) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      name: name.trim(),
      username: username.trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : '',
      homeCity: homeCity ? String(homeCity).trim() : '',
      passwordHash,
      isAdmin: false,
      preferredCategories: [],
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    await writeDB(db);

    const token = signToken(newUser, rememberMe);
    return res.status(201).json({ token, user: toPublicUser(newUser) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password, rememberMe } = req.body || {};
    if (!identifier || typeof identifier !== 'string' || !password) {
      return res.status(400).json({ error: 'identifier and password are required' });
    }

    const db = await readDB();
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const user = db.users.find(
      (u) => u.email === normalizedIdentifier || u.username.toLowerCase() === normalizedIdentifier
    );

    // Use the same generic error whether the identifier or the password was
    // wrong, so we don't leak which accounts exist.
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.authProvider === 'google') {
      return res.status(400).json({ error: 'This account uses Google Sign-In. Please use the Google button to log in.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user, rememberMe);
    return res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/google
// Accepts { idToken } - the credential Google's Identity Services button
// hands back client-side. NEVER trust that token's contents without
// verifying it server-side first: verifyIdToken() checks the signature,
// issuer and expiry, and that it was issued for OUR GOOGLE_CLIENT_ID
// (the "audience"), so a token minted for some other app can't be replayed
// here. Logs in an existing account (matched by Google "sub" first, then
// by email) or creates a new passwordless one.
router.post('/google', async (req, res, next) => {
  try {
    const { idToken, rememberMe } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'idToken is required' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: 'Google Sign-In is not configured on this server' });
    }

    let payload;
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid Google sign-in token' });
    }

    if (!payload || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google sign-in token' });
    }

    const googleId = payload.sub;
    const normalizedEmail = payload.email.trim().toLowerCase();
    const name = (payload.name && payload.name.trim()) || normalizedEmail.split('@')[0];

    const db = await readDB();

    // Match by Google "sub" first (fast path for a returning Google user),
    // then fall back to matching by email (first-ever Google login on an
    // account that already exists from the regular signup flow).
    let user = db.users.find((u) => u.googleId === googleId);
    let isNewUser = false;

    if (!user) {
      user = db.users.find((u) => u.email === normalizedEmail);
      if (user && !user.googleId) {
        user.googleId = googleId;
        await writeDB(db);
      }
    }

    if (!user) {
      const existingUsernamesLower = new Set(db.users.map((u) => u.username.toLowerCase()));
      user = {
        id: uuidv4(),
        name,
        username: generateUsernameFromEmail(normalizedEmail, existingUsernamesLower),
        email: normalizedEmail,
        phone: '',
        homeCity: '',
        passwordHash: null,
        authProvider: 'google',
        googleId,
        isAdmin: false,
        preferredCategories: [],
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      await writeDB(db);
      isNewUser = true;
    }

    const token = signToken(user, rememberMe);
    return res.status(isNewUser ? 201 : 200).json({ token, user: toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
