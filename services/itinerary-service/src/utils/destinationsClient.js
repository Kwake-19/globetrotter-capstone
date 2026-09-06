const BASE_URL = process.env.DESTINATIONS_SERVICE_URL || 'http://localhost:4002';

/**
 * The monolith's itinerary routes read the destination list straight off
 * the shared db. In Phase 2 that data lives in destinations-service, so we
 * fetch it over HTTP for the two operations that genuinely need it:
 *   - validating every destinationId when an itinerary is created/edited
 *   - enriching a shared itinerary with each stop's full destination object
 *
 * A failure is surfaced as an Error with status 503 so the route returns a
 * clear "temporarily unavailable" instead of the request crashing.
 */
async function fetchDestinations() {
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

module.exports = { fetchDestinations, BASE_URL };
