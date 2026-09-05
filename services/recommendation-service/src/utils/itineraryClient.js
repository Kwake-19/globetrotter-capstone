const BASE_URL = process.env.ITINERARY_SERVICE_URL || 'http://localhost:4002';

/**
 * Synchronous REST call to the Itinerary Service - the
 * "Recommendation Service calling ... Service" example from the
 * architecture diagram. Forwards the caller's own Authorization header so
 * Itinerary Service can verify the JWT itself and scope the results to
 * that user, without this service needing to know anything about sessions.
 *
 * Personalization is a nice-to-have, not a hard dependency: if Itinerary
 * Service is down or errors, callers should fall back to non-personalized
 * results rather than fail the whole request (same "degrade, don't crash"
 * approach Phase 1 used for the optional Groq search integration).
 */
async function fetchUserItineraries(authHeader) {
  const res = await fetch(`${BASE_URL}/api/itineraries`, {
    headers: { Authorization: authHeader }
  });
  if (!res.ok) {
    const error = new Error(`Itinerary Service returned HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const body = await res.json();
  return body.results;
}

module.exports = { fetchUserItineraries };
