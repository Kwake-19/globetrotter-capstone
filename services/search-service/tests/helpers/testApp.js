/**
 * search-service owns no data and makes every downstream call over global
 * fetch - to destinations-service for the catalog, and to OpenRouter / Groq
 * for query parsing. Per the Phase 2 brief these are all MOCKED here so the
 * service is testable in isolation.
 *
 * installFetchMock() routes a fetch call by its URL:
 *   .../api/destinations   -> the fixture catalog (or a failure)
 *   openrouter.ai/...       -> the OpenRouter chat-completion stub
 *   api.groq.com/...        -> the Groq chat-completion stub
 */

process.env.NODE_ENV = 'test';
process.env.DESTINATIONS_SERVICE_URL = 'http://destinations-service:4002';
process.env.OPENROUTER_MODEL = 'test/primary-model';
process.env.OPENROUTER_FALLBACK_MODEL = 'test/fallback-model';

const FIXTURE_DESTINATIONS = [
  {
    id: 'd-hotel-lux-1', name: 'Mansel Hotel', category: 'hotel', neighborhood: 'Bastos',
    description: 'Upscale hotel with a rooftop pool.', tags: ['pool', 'rooftop'],
    rating: 4.6, priceLevel: 3, userRatingAvg: null, userRatingCount: 0
  },
  {
    id: 'd-hotel-lux-2', name: 'La Falaise Hotel', category: 'hotel', neighborhood: 'Centre-ville',
    description: 'Business hotel near the centre.', tags: [],
    rating: 4.3, priceLevel: 3, userRatingAvg: null, userRatingCount: 0
  },
  {
    id: 'd-hotel-budget', name: 'Cozy Inn', category: 'hotel', neighborhood: 'Mvog-Mbi',
    description: 'Simple, affordable rooms.', tags: [],
    rating: 3.9, priceLevel: 1, userRatingAvg: null, userRatingCount: 0
  },
  {
    id: 'd-resto-pizza', name: 'Seven Hills', category: 'restaurant', neighborhood: 'Bastos',
    description: 'Wood-fired pizza and pasta.', tags: ['pizza', 'cozy'],
    rating: 4.5, priceLevel: 2, userRatingAvg: null, userRatingCount: 0
  },
  {
    id: 'd-resto-fish', name: 'Le Grillardin', category: 'restaurant', neighborhood: 'Elig-Essono',
    description: 'Grilled fish and local dishes.', tags: ['grilled fish'],
    rating: 4.1, priceLevel: 2, userRatingAvg: null, userRatingCount: 0
  },
  {
    id: 'd-icecream', name: 'Glacier Delice', category: 'ice_cream', neighborhood: 'Centre-ville',
    description: 'Ice cream and desserts.', tags: [],
    rating: 4.0, priceLevel: 1, userRatingAvg: null, userRatingCount: 0
  }
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A chat-completion response whose single choice carries `content`. */
function chatCompletion(content) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function createTestApp() {
  jest.resetModules();
  const { createApp } = require('../../src/app');
  return { app: createApp() };
}

/**
 * @param {object} opts
 * @param {Array|Error|number} opts.destinations  fixture list (default), an Error to reject with, or an HTTP status number to fail with
 * @param {Response|Error|Function} opts.openrouter  response for openrouter.ai calls
 * @param {Response|Error|Function} opts.groq  response for api.groq.com calls
 */
function installFetchMock(opts = {}) {
  const {
    destinations = FIXTURE_DESTINATIONS,
    openrouter,
    groq
  } = opts;

  global.fetch = jest.fn(async (url, init) => {
    const u = String(url);

    if (u.includes('/api/destinations')) {
      if (destinations instanceof Error) throw destinations;
      if (typeof destinations === 'number') return jsonResponse({ error: 'boom' }, destinations);
      return jsonResponse({ count: destinations.length, results: destinations });
    }

    if (u.includes('openrouter.ai')) {
      if (!openrouter) return chatCompletion('{}');
      if (openrouter instanceof Error) throw openrouter;
      if (typeof openrouter === 'function') return openrouter(url, init);
      return openrouter;
    }

    if (u.includes('api.groq.com')) {
      if (!groq) return chatCompletion('{}');
      if (groq instanceof Error) throw groq;
      if (typeof groq === 'function') return groq(url, init);
      return groq;
    }

    throw new Error(`unexpected fetch in test: ${u}`);
  });

  return global.fetch;
}

function clearFetchMock() {
  delete global.fetch;
}

module.exports = {
  createTestApp,
  installFetchMock,
  clearFetchMock,
  chatCompletion,
  jsonResponse,
  FIXTURE_DESTINATIONS
};
