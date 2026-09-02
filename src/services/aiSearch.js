/**
 * Turns a free-text search query into structured filters using an LLM
 * served through OpenRouter's free tier (https://openrouter.ai).
 *
 * Design goals:
 *  - Never let a slow/unavailable AI provider hang or break the request
 *    that's calling it. Everything here either resolves with a parsed
 *    filter object, or rejects with a single, clearly-typed error
 *    (`err.code === 'AI_UNAVAILABLE'`) that the caller can catch and
 *    degrade to plain keyword search on.
 *  - Try OPENROUTER_MODEL first, then OPENROUTER_FALLBACK_MODEL once if
 *    that fails for any reason (bad response, timeout, rate limit).
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 6000;

function aiUnavailable(message) {
  const err = new Error(message);
  err.code = 'AI_UNAVAILABLE';
  return err;
}

function buildSystemPrompt(categories) {
  const categoryEnum = categories.map((c) => `"${c}"`).join(' | ');

  return `You are a search-query parser for a travel app that helps visitors find places to go in Yaounde, Cameroon: restaurants, ice cream/dessert spots, malls, fun places/attractions, hotels and petrol stations.

Given a visitor's free-text search query, extract structured search filters from it and respond with ONLY a JSON object - no prose, no explanation, no markdown code fences - matching exactly this shape:
{
  "category": ${categoryEnum} | null,
  "neighborhood": string | null,
  "keywords": string[],
  "minRating": number | null
}

Rules:
- "category" must be null if the query does not clearly imply one of those categories. Only set it when the query clearly points to a single one of them.
- "neighborhood" should only be set if the query names a specific area/neighborhood (e.g. "Bastos", "Elig-Essono"). Otherwise it must be null.
- "keywords" should capture any descriptive terms from the query that are useful for matching against a place's name, description or tags later - amenities, vibe, or price cues (e.g. "wifi", "rooftop", "cozy", "budget", "grilled fish"). Use lowercase single words or short phrases. Use an empty array if there are none.
- "minRating" should only be set if the query implies the visitor wants highly-rated places (e.g. "best", "top-rated", "highly rated"). Use 4.0 in that case. Otherwise it must be null.

Respond with ONLY the JSON object described above. Do not wrap it in markdown code fences and do not add any other text.`;
}

async function callOpenRouterModel(apiKey, model, systemPrompt, userMessage) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let res;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.1,
          max_tokens: 300
        }),
        signal: controller.signal
      });
    } catch (err) {
      // Covers network errors and the AbortController firing on timeout.
      const reason = err.name === 'AbortError' ? 'timed out' : err.message;
      throw new Error(`OpenRouter request to ${model} failed: ${reason}`);
    }

    if (!res.ok) {
      // Covers rate limiting (429) and any other non-2xx response.
      throw new Error(`OpenRouter request to ${model} returned HTTP ${res.status}`);
    }

    const body = await res.json();
    const content = body && body.choices && body.choices[0] && body.choices[0].message
      && body.choices[0].message.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(`OpenRouter response from ${model} had no content`);
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Best-effort JSON parse: tolerates the model wrapping its answer in a markdown fence. */
function safeParseModelJson(content) {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function normalizeParsedFilters(parsed, categories) {
  const category = categories.includes(parsed.category) ? parsed.category : null;

  const neighborhood = typeof parsed.neighborhood === 'string' && parsed.neighborhood.trim()
    ? parsed.neighborhood.trim()
    : null;

  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim().toLowerCase())
    : [];

  const minRating = typeof parsed.minRating === 'number' && Number.isFinite(parsed.minRating)
    ? parsed.minRating
    : null;

  return { category, neighborhood, keywords, minRating };
}

/**
 * Sends one chat completion request to OpenRouter, trying OPENROUTER_MODEL
 * first and retrying once with OPENROUTER_FALLBACK_MODEL on any failure
 * (network/timeout error, non-2xx response, rate limit). Returns the raw
 * text content of the reply. Throws an error with `code: 'AI_UNAVAILABLE'`
 * whenever the AI path can't be trusted - no API key configured, or both
 * models failed - so callers can catch that one error type and degrade
 * gracefully instead of crashing or hanging.
 *
 * This is the shared low-level building block behind parseSearchQuery()
 * (search) and scripts/generate-descriptions.js (one-off description
 * generation) - both reuse this instead of duplicating the retry/timeout
 * logic.
 */
async function requestChatCompletion(systemPrompt, userMessage) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Don't waste a request on a call we already know will fail.
    throw aiUnavailable('OPENROUTER_API_KEY is not configured');
  }

  const models = [process.env.OPENROUTER_MODEL, process.env.OPENROUTER_FALLBACK_MODEL].filter(Boolean);
  if (models.length === 0) {
    throw aiUnavailable('No OpenRouter model configured');
  }

  let content = null;
  let lastError = null;

  for (const model of models) {
    try {
      // eslint-disable-next-line no-await-in-loop
      content = await callOpenRouterModel(apiKey, model, systemPrompt, userMessage);
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (content === null) {
    throw aiUnavailable(`OpenRouter request failed: ${lastError ? lastError.message : 'unknown error'}`);
  }

  return content;
}

/**
 * Parses a free-text search query into { category, neighborhood, keywords,
 * minRating } using OpenRouter. Throws an error with `code: 'AI_UNAVAILABLE'`
 * whenever the AI path can't be trusted (no API key, network/timeout error,
 * non-2xx response from both models, or a response that isn't valid JSON) -
 * callers should catch that and fall back to keyword search.
 */
async function parseSearchQuery(queryText, categories) {
  const content = await requestChatCompletion(buildSystemPrompt(categories), queryText);

  const parsed = safeParseModelJson(content);
  if (!parsed || typeof parsed !== 'object') {
    throw aiUnavailable('OpenRouter response was not valid JSON');
  }

  return normalizeParsedFilters(parsed, categories);
}

module.exports = { parseSearchQuery, requestChatCompletion };
