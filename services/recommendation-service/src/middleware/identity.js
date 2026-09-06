/**
 * /api/recommendations is personalized when a user is present and popular
 * otherwise (the monolith used optionalAuth). The gateway forwards
 * X-User-Id only when there's a valid token, so its mere presence is the
 * "is this a logged-in request" signal here.
 */
function identity(req, res, next) {
  req.userId = req.headers['x-user-id'] || null;
  return next();
}

module.exports = { identity };
