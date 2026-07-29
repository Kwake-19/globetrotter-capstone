/**
 * Catches anything thrown/passed to next(err) in route handlers so a bug in
 * one endpoint returns a clean JSON error instead of crashing the server or
 * leaking a stack trace to the client.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(`[error] ${req.method} ${req.originalUrl} -`, err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Something went wrong on our end.' : err.message
  });
}

function notFound(req, res) {
  res.status(404).json({ error: `No route matches ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
