const jwt = require('jsonwebtoken');

/**
 * Requires a valid "Authorization: Bearer <token>" header.
 * On success, attaches { id, name, email } to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header. Expected: Bearer <token>' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, name: payload.name, email: payload.email };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Like requireAuth, but never blocks the request - it just attaches
 * req.user if a valid token is present. Used by /recommendations, which
 * can personalize results for logged-in users but still works for guests.
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

module.exports = { requireAuth, optionalAuth };
