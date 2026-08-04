const express = require('express');
const { readDB } = require('../utils/dataStore');

const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'hotel', 'petrol_station'];
const MAX_RESULTS = 24;

const SYSTEM_PROMPT = `You turn a visitor's natural-language request about places in Yaounde, Cameroon into a structured search filter.
Respond with ONLY a JSON object shaped exactly like: { "category": string or null, "keywords": string[] }.
- "category" must be exactly one of ${JSON.stringify(VALID_CATEGORIES)}, or null if the request could reasonably span more than one category.
- "keywords" is a short list (at most 5) of specific words or short phrases from their request useful for matching against a place's name, description, tags or neighborhood (e.g. "wine", "grilled fish", "cozy", "rooftop", "budget"). Do not include the category name itself as a keyword.
Never invent or suggest specific place names - only extract the visitor's intent.`;

function plainSubstringSearch(destinations, q) {
  const term = q.toLowerCase();
  return destinations.filter((d) => (
    d.name.toLowerCase().includes(term) ||
    (d.description || '').toLowerCase().includes(term) ||
    (d.tags || []).some((tag) => tag.toLowerCase().includes(term))
  ));
}

async function translateQuery(query) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 200
    })
  });

  if (!res.ok) {
    throw new Error(`Groq request failed: HTTP ${res.status}`);
  }

  const body = await res.json();
  const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  const parsed = JSON.parse(content);

  const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : null;
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.filter((k) => typeof k === 'string' && k.trim()).slice(0, 5)
    : [];
  return { category, keywords };
}

function scoreDestination(destination, keywords) {
  const haystack = [destination.name, destination.description, destination.neighborhood, ...(destination.tags || [])]
    .join(' ')
    .toLowerCase();
  return keywords.reduce((score, keyword) => (haystack.includes(keyword.toLowerCase()) ? score + 1 : score), 0);
}

function rankByUnderstanding(destinations, understood) {
  let candidates = destinations;
  if (understood.category) {
    candidates = candidates.filter((d) => d.category === understood.category);
  }

  if (understood.keywords.length === 0) {
    return candidates.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, MAX_RESULTS);
  }

  const scored = candidates
    .map((d) => ({ destination: d, score: scoreDestination(d, understood.keywords) }))
    .sort((a, b) => b.score - a.score || (b.destination.rating || 0) - (a.destination.rating || 0));

  // If nothing actually matched a keyword, fall back to the whole category
  // (still ranked by rating) rather than returning zero results just
  // because no place's text happens to contain those exact words.
  const matched = scored.filter((s) => s.score > 0);
  return (matched.length > 0 ? matched : scored).slice(0, MAX_RESULTS).map((s) => s.destination);
}

// GET /api/search?q=<natural language query>
// Uses Groq (if configured) to turn the query into a { category, keywords }
// filter, then matches that against the real destinations in data/db.json -
// the AI only ever interprets intent, it never invents results.
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const db = await readDB();

    if (!GROQ_API_KEY) {
      const results = plainSubstringSearch(db.destinations, q);
      return res.json({ count: results.length, results, understood: null });
    }

    let understood;
    try {
      understood = await translateQuery(q);
    } catch (err) {
      // Groq unavailable/rate-limited - degrade to plain substring search
      // rather than fail the whole request.
      const results = plainSubstringSearch(db.destinations, q);
      return res.json({ count: results.length, results, understood: null });
    }

    const results = rankByUnderstanding(db.destinations, understood);
    return res.json({ count: results.length, results, understood });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
