const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth');
const destinationsRoutes = require('./routes/destinations');
const itinerariesRoutes = require('./routes/itineraries');

function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api', authRoutes);
  app.use('/api', destinationsRoutes);
  app.use('/api', itinerariesRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
