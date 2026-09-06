const DESTINATIONS_BASE_URL = process.env.DESTINATIONS_SERVICE_URL || 'http://localhost:4002';
const ITINERARY_BASE_URL = process.env.ITINERARY_SERVICE_URL || 'http://localhost:4004';

/**
 * The monolith's recommendations route read db.destinations + db.itineraries
 * directly. In Phase 2 those live in two other services, reached over HTTP:
 *
 *  - destinations-service is a hard dependency: no catalog, no
 *    recommendations, so a failure here is surfaced as status 503.
 *  - itinerary-service is a soft dependency: it only adds personalization,
 *    so a failure there is swallowed and the caller falls back to popular
 *    (non-personalized) results - same "degrade, don't crash" approach the
 *    monolith used for its optional AI integrations.
 */
async function fetchAllDestinations() {
  let res;
  try {
    res = await fetch(`${DESTINATIONS_BASE_URL}/api/destinations`);
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

/**
 * Fetches the given user's itineraries. Returns [] (and logs a warning) if
 * itinerary-service is unavailable or errors - personalization is a
 * nice-to-have, not worth failing the whole request over.
 */
async function fetchUserItinerariesSafe(userId) {
  try {
    const res = await fetch(`${ITINERARY_BASE_URL}/api/itineraries`, {
      headers: { 'X-User-Id': userId }
    });
    if (!res.ok) {
      console.warn(`[recommendation-service] itinerary-service returned HTTP ${res.status} - serving non-personalized results`);
      return [];
    }
    const body = await res.json();
    return Array.isArray(body.results) ? body.results : [];
  } catch (err) {
    console.warn(`[recommendation-service] itinerary-service unreachable (${err.message}) - serving non-personalized results`);
    return [];
  }
}

module.exports = { fetchAllDestinations, fetchUserItinerariesSafe, DESTINATIONS_BASE_URL, ITINERARY_BASE_URL };
