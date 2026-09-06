const express = require('express');
const { fetchAllDestinations } = require('../utils/destinationsClient');
const { parseSearchQuery } = require('../services/aiSearch');
const { matchSignals } = require('../services/searchSynonyms');
const { rankDestinations, scoreDestination } = require('../services/searchRanking');

const router = express.Router();

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'petrol_station', 'hotel'];

// GET /api/destinations/smart-search?q=<free text>
// Relocated from the monolith's src/routes/destinations.routes.js. The only
// change: the destination list now comes from destinations-service over
// HTTP instead of a local db read.
//
// Uses OpenRouter (if configured) to parse the query into signals, merges
// in whatever the synonym table also matches, then scores + ranks every
// destination against the combined signals - nothing is hard-filtered out
// for a partial mismatch, it just scores lower.
//
// NOTE: the monolith also fed each destination's concatenated review text
// into the ranker as a low-weight signal. That data lives in
// destinations-service now and isn't exposed on GET /api/destinations, so
// this service ranks without it (reviewTextByDestinationId = {}).
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    let destinations;
    try {
      destinations = await fetchAllDestinations();
    } catch (err) {
      return res.status(503).json({ error: 'Search is temporarily unavailable - could not reach the destinations service' });
    }

    let aiParsed = true;
    let aiSignals = null;

    try {
      aiSignals = await parseSearchQuery(q, VALID_CATEGORIES);
    } catch (err) {
      // AI_UNAVAILABLE (missing key, network/timeout, both models failed,
      // or non-JSON response) - the synonym table becomes the entire
      // signal source below.
      aiParsed = false;
    }

    const synonymSignals = matchSignals(q);

    // Both sources contribute keywords (union, deduped); for a single-value
    // signal the AI's value wins whenever it set one - the synonym table
    // only fills in what the AI left null, and is the entire source when
    // the AI failed (aiSignals is null).
    const signals = {
      category: (aiSignals && aiSignals.category) ?? synonymSignals.category,
      neighborhood: (aiSignals && aiSignals.neighborhood) ?? null,
      priceLevel: (aiSignals && aiSignals.priceLevel) ?? synonymSignals.priceLevel,
      minRating: (aiSignals && aiSignals.minRating) ?? synonymSignals.minRating,
      keywords: [...new Set([...(aiSignals ? aiSignals.keywords : []), ...synonymSignals.keywords])]
    };

    const { results, fallback } = rankDestinations(destinations, signals, {});

    if (process.env.NODE_ENV !== 'test') {
      console.log(
        `[smart-search] q=${JSON.stringify(q)} aiParsed=${aiParsed} fallback=${fallback} top=`,
        results.slice(0, 3).map((d) => ({ name: d.name, score: scoreDestination(d, signals) }))
      );
    }

    return res.json({
      aiParsed,
      signals,
      fallback,
      count: results.length,
      results
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
