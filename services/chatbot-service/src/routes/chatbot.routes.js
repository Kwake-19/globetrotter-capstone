const express = require('express');
const { fetchSuggestedPlaces } = require('../utils/searchClient');
const { generateReply } = require('../utils/openRouterClient');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;

function placeLine(place) {
  const bits = [place.name];
  if (place.neighborhood) bits.push(`in ${place.neighborhood}`);
  if (typeof place.rating === 'number') bits.push(`(rated ${place.rating.toFixed(1)})`);
  return `- ${bits.join(' ')}`;
}

/** Plain, no-LLM answer - used when OpenRouter has no key or fails. */
function templatedReply(message, places) {
  if (places.length === 0) {
    return `I couldn't find a place in Yaounde matching "${message}". Try naming a type of place (restaurant, hotel, mall, ice cream, fun place, petrol station) or a neighbourhood.`;
  }
  return [
    `Here are some places in Yaounde that match "${message}":`,
    ...places.map(placeLine),
    '',
    'Open any of them from the Browse page for hours, photos and reviews.'
  ].join('\n');
}

function buildLlmMessages(message, history, places) {
  const placeContext = places.length
    ? places.map(placeLine).join('\n')
    : '(no matching places were found in the catalogue)';

  const system = [
    'You are the GlobeTrotter navigation assistant for Yaounde, Cameroon.',
    'Help the visitor decide where to go using ONLY the candidate places listed below.',
    'Never invent place names, ratings or addresses. If the list is empty or a poor',
    'match, say so plainly and suggest how to rephrase. Keep replies to a few sentences.',
    '',
    'Candidate places:',
    placeContext
  ].join('\n');

  const trimmedHistory = Array.isArray(history)
    ? history
      .filter((t) => t && typeof t.content === 'string' && (t.role === 'user' || t.role === 'assistant'))
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_LENGTH) }))
    : [];

  return [
    { role: 'system', content: system },
    ...trimmedHistory,
    { role: 'user', content: message }
  ];
}

// POST /api/chatbot  { message, history?: [{ role, content }] }
// Chain: search-service (suggested places) -> OpenRouter (conversational
// reply). search-service failing is a hard error (503); OpenRouter failing
// or having no key falls back to a templated reply built from the same
// places, so the assistant still works.
router.post('/', async (req, res, next) => {
  try {
    const { message, history } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const trimmedMessage = message.trim();

    let places;
    try {
      places = await fetchSuggestedPlaces(trimmedMessage);
    } catch (err) {
      return res.status(503).json({ error: 'The assistant is temporarily unavailable - could not reach the search service' });
    }

    let reply;
    let aiReply = true;
    try {
      reply = await generateReply(buildLlmMessages(trimmedMessage, history, places));
    } catch (err) {
      aiReply = false;
      reply = templatedReply(trimmedMessage, places);
    }

    return res.json({ reply, aiReply, suggestedPlaces: places });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
