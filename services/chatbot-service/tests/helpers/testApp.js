/**
 * chatbot-service owns no data. It calls search-service and OpenRouter
 * over global fetch; per the Phase 2 brief both are MOCKED here.
 * installFetchMock() routes by URL:
 *   .../api/search   -> search-service results (or a failure)
 *   openrouter.ai/... -> the chat-completion reply (or a failure)
 */

process.env.NODE_ENV = 'test';
process.env.SEARCH_SERVICE_URL = 'http://search-service:4003';

const FIXTURE_PLACES = [
  { id: 'p1', name: 'Seven Hills', neighborhood: 'Bastos', category: 'restaurant', rating: 4.5 },
  { id: 'p2', name: 'Glacier Delice', neighborhood: 'Centre-ville', category: 'ice_cream', rating: 4.0 }
];

function createTestApp() {
  jest.resetModules();
  const { createApp } = require('../../src/app');
  return { app: createApp() };
}

/**
 * @param {object} opts
 * @param {Array|Error|number} opts.search      search-service results (default), Error to reject, or status number
 * @param {string|Error} opts.openrouterContent reply text, or an Error to reject the OpenRouter call with
 * @param {number} opts.openrouterStatus         non-200 status for the OpenRouter call
 */
function installFetchMock(opts = {}) {
  const { search = FIXTURE_PLACES, openrouterContent = 'Try Seven Hills in Bastos.', openrouterStatus } = opts;

  global.fetch = jest.fn(async (url) => {
    const u = String(url);

    if (u.includes('/api/search')) {
      if (search instanceof Error) throw search;
      if (typeof search === 'number') return new Response('{}', { status: search });
      return new Response(JSON.stringify({ count: search.length, results: search }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    if (u.includes('openrouter.ai')) {
      if (openrouterContent instanceof Error) throw openrouterContent;
      if (openrouterStatus && openrouterStatus !== 200) return new Response('{}', { status: openrouterStatus });
      return new Response(JSON.stringify({ choices: [{ message: { content: openrouterContent } }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    throw new Error(`unexpected fetch in test: ${u}`);
  });

  return global.fetch;
}

function clearFetchMock() {
  delete global.fetch;
}

module.exports = { createTestApp, installFetchMock, clearFetchMock, FIXTURE_PLACES };
