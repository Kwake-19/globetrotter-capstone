const { readDB } = require('../utils/dataStore');

/**
 * Must run AFTER requireAuth (needs req.user.id already set on the
 * request). Looks up the full, current user record - not just what's in
 * the JWT payload, since isAdmin is granted by a manual data/db.json edit
 * (see README) and an already-issued token has no way to reflect that
 * change on its own. 403s if the user isn't an admin.
 */
async function requireAdmin(req, res, next) {
  try {
    const db = await readDB();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin };
