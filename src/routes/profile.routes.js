const express = require('express');
const { readDB, writeDB } = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user; // eslint-disable-line no-unused-vars
  return publicUser;
}

router.use(requireAuth);

// GET /api/profile
router.get('/', async (req, res, next) => {
  try {
    const db = await readDB();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(toPublicUser(user));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/profile - name, phone, homeCity only (Phase 1 keeps email/username/password out of scope)
router.put('/', async (req, res, next) => {
  try {
    const db = await readDB();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { name, phone, homeCity } = req.body || {};
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
      user.name = name.trim();
    }
    if (phone !== undefined) {
      user.phone = String(phone).trim();
    }
    if (homeCity !== undefined) {
      user.homeCity = String(homeCity).trim();
    }

    await writeDB(db);
    return res.json(toPublicUser(user));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
