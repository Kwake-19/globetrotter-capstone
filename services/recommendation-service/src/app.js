const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const destinationsRoutes = require('./routes/destinations.routes');
const recommendationsRoutes = require('./routes/recommendations.routes');
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
    res.json({ status: 'ok', service: 'recommendation-service', timestamp: new Date().toISOString() });
  });

  app.use('/api/destinations', destinationsRoutes);
  app.use('/api/recommendations', recommendationsRoutes);
  app.use('/api/search', searchRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
