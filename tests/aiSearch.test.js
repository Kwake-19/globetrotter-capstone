const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { parseSearchQuery } = require('../src/services/aiSearch');

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'hotel', 'petrol_station'];

/** A fetch Response-shaped object for a successful OpenRouter chat completion. */
function openRouterOk(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  };
}

describe('AI Search (OpenRouter)', () => {
  let app;
  let cleanup;
  let originalFetch;
  let savedEnv;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    savedEnv = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
      OPENROUTER_FALLBACK_MODEL: process.env.OPENROUTER_FALLBACK_MODEL
    };
    process.env.OPENROUTER_MODEL = 'test/primary-model';
    process.env.OPENROUTER_FALLBACK_MODEL = 'test/fallback-model';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.entries(savedEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  describe('parseSearchQuery()', () => {
    it('skips the network call entirely when OPENROUTER_API_KEY is unset', async () => {
      delete process.env.OPENROUTER_API_KEY;
      global.fetch = jest.fn();

      await expect(parseSearchQuery('best hotel', VALID_CATEGORIES))
        .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('parses a well-formed model response into normalized filters', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: 'hotel',
        neighborhood: 'Bastos',
        keywords: ['Wifi', ' Pool '],
        minRating: 4
      })));

      const result = await parseSearchQuery('best hotel in bastos with wifi and a pool', VALID_CATEGORIES);

      expect(result).toEqual({
        category: 'hotel',
        neighborhood: 'Bastos',
        keywords: ['wifi', 'pool'],
        minRating: 4
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('retries once with the fallback model when the primary model fails, then succeeds', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce(openRouterOk(JSON.stringify({
          category: null, neighborhood: null, keywords: [], minRating: null
        })));

      const result = await parseSearchQuery('somewhere nice', VALID_CATEGORIES);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[0][1].body).toContain('test/primary-model');
      expect(global.fetch.mock.calls[1][1].body).toContain('test/fallback-model');
      expect(result.category).toBeNull();
    });

    it('throws AI_UNAVAILABLE when both the primary and fallback model fail', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      await expect(parseSearchQuery('anything', VALID_CATEGORIES))
        .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws AI_UNAVAILABLE (instead of crashing) when the model response is not valid JSON', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk('Sure! Here you go: {category: hotel}'));

      await expect(parseSearchQuery('a nice hotel', VALID_CATEGORIES))
        .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    });
  });

  describe('GET /api/destinations/smart-search', () => {
    it('rejects a missing query with 400', async () => {
      const res = await request(app).get('/api/destinations/smart-search');
      expect(res.status).toBe(400);
    });

    it('filters using a successful AI parse and reports aiParsed: true', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: 'hotel', neighborhood: null, keywords: [], minRating: null
      })));

      const res = await request(app).get('/api/destinations/smart-search?q=find me a hotel');

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(true);
      expect(res.body.filters).toEqual({ category: 'hotel', neighborhood: null, keywords: [], minRating: null });
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results.length).toBe(res.body.count);
      res.body.results.forEach((place) => expect(place.category).toBe('hotel'));
    });

    it('falls back to keyword search and still returns results when the AI call fails', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      const list = await request(app).get('/api/destinations');
      const sampleName = list.body.results[0].name.split(' ')[0];

      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

      const res = await request(app).get(`/api/destinations/smart-search?q=${encodeURIComponent(sampleName)}`);

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(false);
      expect(res.body.filters).toBeNull();
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results.some((p) => p.name.includes(sampleName))).toBe(true);
    });

    it('falls back cleanly to keyword search when the AI returns malformed JSON', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      const list = await request(app).get('/api/destinations');
      const sampleName = list.body.results[0].name.split(' ')[0];

      global.fetch = jest.fn().mockResolvedValue(openRouterOk('not json at all'));

      const res = await request(app).get(`/api/destinations/smart-search?q=${encodeURIComponent(sampleName)}`);

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(false);
      expect(res.body.filters).toBeNull();
      expect(res.body.results.some((p) => p.name.includes(sampleName))).toBe(true);
    });

    it('skips the network call and falls back to keyword search when OPENROUTER_API_KEY is unset', async () => {
      delete process.env.OPENROUTER_API_KEY;
      const list = await request(app).get('/api/destinations');
      const sampleName = list.body.results[0].name.split(' ')[0];

      global.fetch = jest.fn();

      const res = await request(app).get(`/api/destinations/smart-search?q=${encodeURIComponent(sampleName)}`);

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(res.body.results.some((p) => p.name.includes(sampleName))).toBe(true);
    });
  });
});
