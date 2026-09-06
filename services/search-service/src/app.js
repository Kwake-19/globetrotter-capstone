const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const smartSearchRoutes = require('./routes/smartSearch.routes');
const searchRoutes = require('./routes/search.routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'search-service' });
  });

  // The gateway routes both of these AI-search paths here. They keep the
  // exact same URLs the monolith (and therefore the frontend) used.
  app.use('/api/destinations/smart-search', smartSearchRoutes);
  app.use('/api/search', searchRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
