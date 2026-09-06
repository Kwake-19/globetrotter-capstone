const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const itinerariesRoutes = require('./routes/itineraries.routes');
const sharedRoutes = require('./routes/shared.routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'itinerary-service' });
  });

  app.use('/api/itineraries', itinerariesRoutes);
  app.use('/api/shared', sharedRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
