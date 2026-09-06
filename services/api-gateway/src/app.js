const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { verifyToken } = require('./middleware/verifyToken');
const { makeProxy } = require('./middleware/proxy');

// The gateway is the only service that serves the shared Phase 1 frontend.
// Depending on how it's run the repo-root public/ folder sits at a
// different depth, so probe the known candidates.
const PUBLIC_DIR = [
  path.join(__dirname, '..', '..', '..', 'public'), // repo layout: services/api-gateway/src -> repo root
  path.join(__dirname, '..', 'public') // docker image layout: public copied next to src
].find((p) => fs.existsSync(p)) || path.join(__dirname, '..', '..', '..', 'public');

const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  destinations: process.env.DESTINATIONS_SERVICE_URL || 'http://localhost:4002',
  search: process.env.SEARCH_SERVICE_URL || 'http://localhost:4003',
  itinerary: process.env.ITINERARY_SERVICE_URL || 'http://localhost:4004',
  recommendation: process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:4005',
  chatbot: process.env.CHATBOT_SERVICE_URL || 'http://localhost:4006'
};

// --- identity gates (only on routes that need them) ---------------------
function requireUserId(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  return next();
}

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Collect the raw body (any content type) as a Buffer so the proxy can
  // forward it verbatim. The gateway never needs to read request bodies -
  // only pass them along - so there is no express.json() here.
  app.use(express.raw({ type: () => true, limit: '2mb' }));

  // Verify the JWT (if any) up front; downstream routing only ever deals
  // with req.userId / req.isAdmin from here on.
  app.use(verifyToken);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'api-gateway' });
  });

  // Non-secret, frontend-facing configuration. Not owned by any domain
  // service - it's really about the browser app - so the gateway answers
  // it directly rather than proxying.
  app.get('/api/config', (req, res) => {
    res.json({
      googleMapsEmbedKey: process.env.GOOGLE_MAPS_EMBED_KEY || null,
      googleClientId: process.env.GOOGLE_CLIENT_ID || null
    });
  });

  const proxy = (name) => makeProxy(SERVICES[name]);

  // --- search-service ---------------------------------------------------
  // Registered before the generic /api/destinations rule so the
  // smart-search path doesn't fall through to destinations-service.
  app.use('/api/destinations/smart-search', proxy('search'));
  app.use('/api/search', proxy('search'));

  // --- destinations-service ------------------------------------------
  // Catalog + categories + nearby are public (guests browse). Review
  // writes need a user; admin CRUD needs an admin.
  app.post('/api/destinations/:id/reviews', requireUserId, proxy('destinations'));
  app.delete('/api/destinations/:id/reviews/:reviewId', requireUserId, proxy('destinations'));
  app.use('/api/destinations', proxy('destinations'));
  app.use('/api/admin', requireAdmin, proxy('destinations'));

  // --- auth-service ------------------------------------------------------
  app.use('/api/auth', proxy('auth')); // login / register / google are public
  app.use('/api/profile', requireUserId, proxy('auth'));

  // --- itinerary-service ----------------------------------------------
  app.use('/api/itineraries', requireUserId, proxy('itinerary'));
  app.use('/api/shared', proxy('itinerary')); // public share links, no auth

  // --- recommendation-service --------------------------------------
  // Personalized when a token is present, popular otherwise - so no gate,
  // identity is just forwarded when we have it.
  app.use('/api/recommendations', proxy('recommendation'));

  // --- chatbot-service -----------------------------------------------
  app.use('/api/chatbot', proxy('chatbot'));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No route matches ${req.method} ${req.originalUrl}` });
  });

  // Frontend last, so it never shadows an /api/* route.
  app.use(express.static(PUBLIC_DIR));

  return app;
}

module.exports = { createApp, SERVICES };
