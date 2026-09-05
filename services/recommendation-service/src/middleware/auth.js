const jwt = require('jsonwebtoken');

/**
 * Like user-service's requireAuth, but never blocks the request - it just
 * attaches req.user if a valid token is present. Used by /recommendations,
 * which can personalize results for logged-in users but still works for
 * guests.
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: payload.sub, name: payload.name, email: payload.email };
    } catch (err) {
      // Ignore invalid tokens for optional auth - just proceed as a guest.
    }
  }
  return next();
}

module.exports = { optionalAuth };
