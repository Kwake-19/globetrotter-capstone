const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');
const {
  ensureSocialArrays, publicUser, isFollowing, followingIds, followerIds
} = require('../utils/social');

// Mounted at /api (so it owns /api/users* and /api/follows*). requireAuth is
// applied per-route rather than via router.use(), so a non-matching path (e.g.
// GET /api/config) falls straight through without this router 401-ing it.
const router = express.Router();

const SEARCH_LIMIT = 20;

/** Adds youFollow / followsYou (relative to the current user) to a public user. */
function withRelation(db, meId, user) {
  return {
    ...publicUser(user),
    youFollow: isFollowing(db, meId, user.id),
    followsYou: isFollowing(db, user.id, meId)
  };
}

// GET /api/users?q=<term> - search by username or name (case-insensitive
// substring), excluding yourself.
router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    if (!q) return res.status(400).json({ error: 'q is required' });

    const db = await readDB();
    ensureSocialArrays(db);

    const matches = db.users
      .filter((u) => u.id !== req.user.id)
      .filter((u) => u.username.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
      .slice(0, SEARCH_LIMIT)
      .map((u) => withRelation(db, req.user.id, u));

    return res.json({ count: matches.length, results: matches });
  } catch (err) {
    return next(err);
  }
});

// POST /api/users/:id/follow - idempotent
router.post('/users/:id/follow', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    const db = await readDB();
    ensureSocialArrays(db);

    if (!db.users.find((u) => u.id === targetId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!isFollowing(db, req.user.id, targetId)) {
      db.follows.push({
        id: uuidv4(),
        followerId: req.user.id,
        followeeId: targetId,
        createdAt: new Date().toISOString()
      });
      await writeDB(db);
    }

    return res.json({
      following: true,
      mutual: isFollowing(db, targetId, req.user.id)
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/users/:id/follow - idempotent
router.delete('/users/:id/follow', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const db = await readDB();
    ensureSocialArrays(db);

    if (!db.users.find((u) => u.id === targetId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const before = db.follows.length;
    db.follows = db.follows.filter(
      (f) => !(f.followerId === req.user.id && f.followeeId === targetId)
    );
    if (db.follows.length !== before) await writeDB(db);

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// GET /api/users/:id/followers
router.get('/users/:id/followers', requireAuth, async (req, res, next) => {
  try {
    const db = await readDB();
    ensureSocialArrays(db);

    if (!db.users.find((u) => u.id === req.params.id)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ids = new Set(followerIds(db, req.params.id));
    const results = db.users
      .filter((u) => ids.has(u.id))
      .map((u) => withRelation(db, req.user.id, u));

    return res.json({ count: results.length, results });
  } catch (err) {
    return next(err);
  }
});

// GET /api/users/:id/following
router.get('/users/:id/following', requireAuth, async (req, res, next) => {
  try {
    const db = await readDB();
    ensureSocialArrays(db);

    if (!db.users.find((u) => u.id === req.params.id)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ids = new Set(followingIds(db, req.params.id));
    const results = db.users
      .filter((u) => ids.has(u.id))
      .map((u) => withRelation(db, req.user.id, u));

    return res.json({ count: results.length, results });
  } catch (err) {
    return next(err);
  }
});

// GET /api/follows/status?ids=a,b,c - batch relation lookup for the current user
router.get('/follows/status', requireAuth, async (req, res, next) => {
  try {
    const ids = (req.query.ids || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
    const db = await readDB();
    ensureSocialArrays(db);

    const status = {};
    ids.forEach((id) => {
      status[id] = {
        youFollow: isFollowing(db, req.user.id, id),
        followsYou: isFollowing(db, id, req.user.id)
      };
    });

    return res.json({ status });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
