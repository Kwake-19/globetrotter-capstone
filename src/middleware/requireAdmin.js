const { readDB } = require('../utils/dataStore');

/**
 * Looks up whether the given user id is an admin in an already-loaded db
 * object. Not just what's in the JWT payload, since isAdmin is granted by
 * a manual data/db.json edit (see README) and an already-issued token has
 * no way to reflect that change on its own. Exported so other routes that
 * need an "author OR admin" check (e.g. deleting a review) can reuse this
 * exact lookup instead of duplicating it.
 */
function isAdminUser(db, userId) {
  const user = db.users.find((u) => u.id === userId);
  return !!(user && user.isAdmin);
}

/** Must run AFTER requireAuth (needs req.user.id already set). 403s if the user isn't an admin. */
async function requireAdmin(req, res, next) {
  try {
    const db = await readDB();
    if (!isAdminUser(db, req.user.id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin, isAdminUser };
