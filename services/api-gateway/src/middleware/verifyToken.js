const jwt = require('jsonwebtoken');

/**
 * The gateway is the ONLY service that ever sees a JWT. This middleware
 * verifies it (if one is present) and reduces it to plain identity fields
 * that the proxy layer forwards downstream as headers:
 *   req.userId   -> X-User-Id
 *   req.isAdmin  -> X-Is-Admin: true   (header omitted entirely when false)
 *   req.userName -> X-User-Name        (URL-encoded; used by review writes)
 *
 * A missing or invalid/expired token is NOT rejected here - the request
 * proceeds as a guest (req.userId undefined). Individual routes that need
 * a user attach requireUserId / requireAdmin.
 *
 * `isAdmin` is read straight from the token payload (auth-service puts it
 * there at issuance time), so the gateway never has to look a user record
 * up. Trade-off: changing someone's admin flag only takes effect the next
 * time they log in and get a fresh token.
 */
function verifyToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme === 'Bearer' && token && process.env.JWT_SECRET) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.sub;
      req.isAdmin = payload.isAdmin === true;
      req.userName = typeof payload.name === 'string' ? payload.name : null;
    } catch (err) {
      // Invalid / expired token -> continue as a guest.
    }
  }

  return next();
}

module.exports = { verifyToken };
