const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/dataStore');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
  return typeof username === 'string' && username.trim().length >= 3 && username.trim().length <= 30;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user; // eslint-disable-line no-unused-vars
  return publicUser;
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, username, email, password, phone, homeCity } = req.body || {};

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
      preferredCategories: [],
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    await writeDB(db);

    const token = signToken(newUser);
    return res.status(201).json({ token, user: toPublicUser(newUser) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password } = req.body || {};
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

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    return res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
