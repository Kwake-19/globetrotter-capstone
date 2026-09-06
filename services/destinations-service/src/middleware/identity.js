/**
 * In Phase 2 only the API gateway verifies JWTs. It forwards the caller's
 * identity to this service as plain headers:
 *   X-User-Id    -> req.userId
 *   X-Is-Admin   -> req.isAdmin   (only ever sent as the string "true")
 *   X-User-Name  -> req.userName  (URL-encoded; used to denormalize the
 *                                  author name onto a new review, which the
 *                                  monolith read from its users table)
 *
 * Trusting these headers is safe specifically because this service is not
 * reachable from outside the Docker network - only the gateway is.
 */
function identity(req, res, next) {
  req.userId = req.headers['x-user-id'] || null;
  req.isAdmin = req.headers['x-is-admin'] === 'true';
  req.userName = req.headers['x-user-name'] ? decodeURIComponent(req.headers['x-user-name']) : null;
  return next();
}

/** Belt-and-braces: the gateway already gates review writes. */
function requireUserId(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  return next();
}

/** Belt-and-braces: the gateway already gates /api/admin. */
function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  return next();
}

module.exports = { identity, requireUserId, requireAdmin };
