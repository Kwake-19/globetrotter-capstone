const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const destinationsRoutes = require('./routes/destinations.routes');
const recommendationsRoutes = require('./routes/recommendations.routes');
const itinerariesRoutes = require('./routes/itineraries.routes');
const sharedRoutes = require('./routes/shared.routes');
const profileRoutes = require('./routes/profile.routes');
const configRoutes = require('./routes/config.routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());

  // Skip request logging during tests to keep test output readable.
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Serve the basic frontend (Phase 1 UI).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Simple health/readiness endpoint - useful for Docker healthchecks and,
  // later, for load balancers / uptime monitors.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'globetrotter-monolith', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/destinations', destinationsRoutes);
  app.use('/api/recommendations', recommendationsRoutes);
  app.use('/api/itineraries', itinerariesRoutes);
  app.use('/api/shared', sharedRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/config', configRoutes);

  // Anything under /api that didn't match becomes a JSON 404 instead of HTML.
  app.use('/api', notFound);

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
