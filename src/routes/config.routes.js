const express = require('express');

const router = express.Router();

// GET /api/config - small set of non-secret, frontend-facing config values.
// Lets the static frontend use a server-side key (never baked into a JS
// file) without a build step. Only ever add values here that are safe to
// expose to any visitor.
router.get('/', (req, res) => {
  res.json({
    googleMapsEmbedKey: process.env.GOOGLE_MAPS_EMBED_KEY || null
  });
});

module.exports = router;
