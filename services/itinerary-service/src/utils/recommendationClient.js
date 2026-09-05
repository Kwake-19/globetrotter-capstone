const BASE_URL = process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:4003';

/**
 * Synchronous REST call to the Recommendation Service - this is the
 * "Recommendation Service calling User Service"-style dependency from the
 * architecture diagram, just in the other direction: Itinerary Service
 * needs to know which destinations exist before it can validate or enrich
 * a trip. If that service is down, we surface a 503 rather than letting a
 * bad response silently corrupt an itinerary.
 */
async function fetchAllDestinations() {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/destinations`);
  } catch (err) {
    const error = new Error('Recommendation Service is unreachable');
    error.status = 503;
    throw error;
  }
  if (!res.ok) {
    const error = new Error(`Recommendation Service returned HTTP ${res.status}`);
    error.status = 503;
    throw error;
  }
  const body = await res.json();
  return body.results;
}

module.exports = { fetchAllDestinations };
