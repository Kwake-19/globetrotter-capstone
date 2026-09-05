const jwt = require('jsonwebtoken');

/**
 * This service never issues tokens (only user-service does) - it just
 * verifies them with the shared JWT_SECRET, the standard stateless-auth
 * pattern for microservices that avoids a synchronous call to user-service
 * on every request.
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

module.exports = { requireAuth };
