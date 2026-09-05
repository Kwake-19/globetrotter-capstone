function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(`[itinerary-service] [error] ${req.method} ${req.originalUrl} -`, err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Something went wrong on our end.' : err.message
  });
}

function notFound(req, res) {
  res.status(404).json({ error: `No route matches ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
