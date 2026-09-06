const BASE_URL = process.env.SEARCH_SERVICE_URL || 'http://localhost:4003';

/**
 * First hop of the chatbot chain: turn the user's message into a short
 * list of candidate places by asking search-service (NOT
 * destinations-service directly - the chatbot only ever talks to search).
 *
 * A failure is surfaced as an Error with status 503 so the route can tell
 * the caller the assistant is temporarily unavailable instead of crashing.
 */
async function fetchSuggestedPlaces(message, limit = 5) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(message)}`);
  } catch (err) {
    const wrapped = new Error(`search-service is unreachable: ${err.message}`);
    wrapped.status = 503;
    throw wrapped;
  }

  if (!res.ok) {
    const wrapped = new Error(`search-service returned HTTP ${res.status}`);
    wrapped.status = 503;
    throw wrapped;
  }

  const body = await res.json();
  const results = Array.isArray(body.results) ? body.results : [];
  return results.slice(0, limit);
}

module.exports = { fetchSuggestedPlaces, BASE_URL };
