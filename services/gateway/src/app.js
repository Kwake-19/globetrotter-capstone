const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Repo-root public/ - the gateway is the ONLY service that serves the
// frontend (single entry point for all client requests, per the
// architecture diagram). See services/gateway/Dockerfile for how this
// same relative path is preserved inside the container image.
const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');

function proxyTo(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    // Requests reach here before any body-parser runs, so the original
    // request stream (including the raw JSON body) is forwarded as-is.
    onError: (err, req, res) => {
      console.error(`[gateway] proxy error for ${req.method} ${req.originalUrl} -> ${target}:`, err.message);
      res.status(502).json({ error: 'Upstream service is unavailable' });
    }
  });
}

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'gateway', timestamp: new Date().toISOString() });
  });

  // Small set of non-secret, frontend-facing config values - not owned by
  // any single domain service, so the gateway answers it directly.
  app.get('/api/config', (req, res) => {
    res.json({
      googleMapsEmbedKey: process.env.GOOGLE_MAPS_EMBED_KEY || null
    });
  });

  const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
  const ITINERARY_SERVICE_URL = process.env.ITINERARY_SERVICE_URL || 'http://localhost:4002';
  const RECOMMENDATION_SERVICE_URL = process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:4003';

  app.use('/api/auth', proxyTo(USER_SERVICE_URL));
  app.use('/api/profile', proxyTo(USER_SERVICE_URL));

  app.use('/api/itineraries', proxyTo(ITINERARY_SERVICE_URL));
  app.use('/api/shared', proxyTo(ITINERARY_SERVICE_URL));

  app.use('/api/destinations', proxyTo(RECOMMENDATION_SERVICE_URL));
  app.use('/api/recommendations', proxyTo(RECOMMENDATION_SERVICE_URL));
  app.use('/api/search', proxyTo(RECOMMENDATION_SERVICE_URL));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No route matches ${req.method} ${req.originalUrl}` });
  });

  // Serve the frontend last, so it never shadows an /api/* route above.
  app.use(express.static(PUBLIC_DIR));

  return app;
}

module.exports = { createApp };
