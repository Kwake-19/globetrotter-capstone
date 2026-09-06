const BASE_URL = process.env.DESTINATIONS_SERVICE_URL || 'http://localhost:4002';

/**
 * The synchronous, REST half of Phase 2's inter-service communication:
 * search-service owns no data, so on every request it pulls the current
 * destination list from destinations-service and ranks it in memory.
 *
 * A failure here (connection refused, non-2xx) is turned into an Error
 * with `status = 503` so the route can return a clear "search temporarily
 * unavailable" to the caller instead of the whole request crashing - a
 * chain of HTTP calls has more failure points than the monolith's local
 * array read did.
 */
async function fetchAllDestinations() {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/destinations`);
  } catch (err) {
    const wrapped = new Error(`destinations-service is unreachable: ${err.message}`);
    wrapped.status = 503;
    throw wrapped;
  }

  if (!res.ok) {
    const wrapped = new Error(`destinations-service returned HTTP ${res.status}`);
    wrapped.status = 503;
    throw wrapped;
  }

  const body = await res.json();
  return Array.isArray(body.results) ? body.results : [];
}

module.exports = { fetchAllDestinations, BASE_URL };
