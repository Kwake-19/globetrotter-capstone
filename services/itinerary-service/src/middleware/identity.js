/**
 * In Phase 2 only the API gateway verifies JWTs. It forwards the caller's
 * identity as headers; we read X-User-Id here in the same places the
 * monolith read req.user.id. Safe to trust because this service is not
 * reachable from outside the Docker network - only the gateway is.
 */
function identity(req, res, next) {
  req.userId = req.headers['x-user-id'] || null;
  req.isAdmin = req.headers['x-is-admin'] === 'true';
  return next();
}

/** Belt-and-braces: the gateway already gates every /api/itineraries route. */
function requireUserId(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  return next();
}

module.exports = { identity, requireUserId };
