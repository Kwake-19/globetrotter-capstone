const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'authentication required' });
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload.sub;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'authentication required' });
  }
}

module.exports = { requireAuth };
