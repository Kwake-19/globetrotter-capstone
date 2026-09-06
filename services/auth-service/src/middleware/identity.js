/**
 * In Phase 2 only the API gateway verifies JWTs. It forwards the caller's
 * identity to this service as plain headers:
 *   X-User-Id    -> req.userId
 *   X-Is-Admin   -> req.isAdmin   (only ever sent as the string "true")
 *   X-User-Name  -> req.userName  (URL-encoded)
 *
 * We read them here, in the same places the monolith read req.user.id.
 * Trusting these headers is safe specifically because this service is not
 * reachable from outside the Docker network - only the gateway is - so the
 * gateway's verifyToken is the only possible source of an X-User-* header.
 */
function identity(req, res, next) {
  req.userId = req.headers['x-user-id'] || null;
  req.isAdmin = req.headers['x-is-admin'] === 'true';
  req.userName = req.headers['x-user-name'] ? decodeURIComponent(req.headers['x-user-name']) : null;
  return next();
}

/** Belt-and-braces: the gateway already gates these routes. */
function requireUserId(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  return next();
}

module.exports = { identity, requireUserId };
