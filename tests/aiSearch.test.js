const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { parseSearchQuery } = require('../src/services/aiSearch');
const { matchSignals } = require('../src/services/searchSynonyms');
const { rankDestinations, scoreDestination } = require('../src/services/searchRanking');

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
        minRating: 4,
        priceLevel: 3
      })));

      const result = await parseSearchQuery('best luxury hotel in bastos with wifi and a pool', VALID_CATEGORIES);

      expect(result).toEqual({
        category: 'hotel',
        neighborhood: 'Bastos',
        keywords: ['wifi', 'pool'],
        minRating: 4,
        priceLevel: 3
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('normalizes an out-of-range or missing priceLevel to null', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: null, neighborhood: null, keywords: [], minRating: null, priceLevel: 7
      })));

      const result = await parseSearchQuery('somewhere', VALID_CATEGORIES);
      expect(result.priceLevel).toBeNull();
    });

    it('retries once with the fallback model when the primary model fails, then succeeds', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce(openRouterOk(JSON.stringify({
          category: null, neighborhood: null, keywords: [], minRating: null, priceLevel: null
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

    it('ranks results using a successful AI parse and reports aiParsed: true', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: 'hotel', neighborhood: null, keywords: [], minRating: null, priceLevel: null
      })));

      const res = await request(app).get('/api/destinations/smart-search?q=find me a hotel');

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(true);
      expect(res.body.fallback).toBeNull();
      expect(res.body.signals).toEqual({
        category: 'hotel', neighborhood: null, keywords: [], minRating: null, priceLevel: null
      });
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results.length).toBe(res.body.count);
      // Not a hard filter any more - every hotel should be present (and
      // ranked ahead of non-hotels), but other categories aren't excluded.
      expect(res.body.results[0].category).toBe('hotel');
    });

    it('ranks the best multi-signal match first (category + priceLevel together)', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      // Real seed data: only Mansel Hotel Yaounde and La Falaise Hotel
      // Yaounde are hotels with priceLevel === 3; Mansel has the higher
      // rating of the two, so it should score highest and sort first.
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: 'hotel', neighborhood: null, keywords: [], minRating: null, priceLevel: 3
      })));

      const res = await request(app).get('/api/destinations/smart-search?q=luxury hotels');

      expect(res.status).toBe(200);
      expect(res.body.fallback).toBeNull();
      expect(res.body.results[0].name).toBe('Mansel Hotel Yaounde');
      expect(res.body.results[1].name).toBe('La Falaise Hotel Yaounde');
    });

    it('still returns results for a query with only a weak/partial signal match (never a hard zero)', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      // A keyword that matches nothing, and no category/price/rating
      // signal at all - a hard-filter system would return 0 here.
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: null, neighborhood: null, keywords: ['zzz-no-such-word'], minRating: null, priceLevel: null
      })));

      const res = await request(app).get('/api/destinations/smart-search?q=zzz-no-such-word');

      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
      // Nothing scored above 0 from the (non-matching) keyword - the
      // rating tiebreaker alone carried every result, so this isn't the
      // explicit "no exact match" fallback, just a weakly-ranked list.
      expect(res.body.fallback).toBeNull();
    });

    it('maps a budget query with no literal price words to priceLevel, not keywords (AI path)', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: 'hotel', neighborhood: null, keywords: [], minRating: null, priceLevel: 1
      })));

      const res = await request(app).get('/api/destinations/smart-search?q=budget friendly hotels');

      expect(res.status).toBe(200);
      expect(res.body.signals.priceLevel).toBe(1);
      expect(res.body.count).toBeGreaterThan(0);
      // Hotels with priceLevel exactly 1 (or unset) should outrank the
      // ones with a known higher tier.
      expect(res.body.results[0].priceLevel === 1 || res.body.results[0].priceLevel === null).toBe(true);
    });

    it('falls back to synonym-table signals and still returns results when the AI call fails', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

      const res = await request(app).get('/api/destinations/smart-search?q=budget friendly hotels');

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(false);
      // "hotels" -> category: hotel, "budget friendly" -> priceLevel: 1,
      // purely from the synonym table since the AI is unavailable.
      expect(res.body.signals.category).toBe('hotel');
      expect(res.body.signals.priceLevel).toBe(1);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results[0].category).toBe('hotel');
    });

    it('falls back cleanly to synonym-table signals when the AI returns malformed JSON', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(openRouterOk('not json at all'));

      const res = await request(app).get('/api/destinations/smart-search?q=looking for an upscale hotel');

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(false);
      expect(res.body.signals.category).toBe('hotel');
      expect(res.body.signals.priceLevel).toBe(3);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('skips the network call and uses the synonym table when OPENROUTER_API_KEY is unset', async () => {
      delete process.env.OPENROUTER_API_KEY;
      global.fetch = jest.fn();

      const res = await request(app).get('/api/destinations/smart-search?q=cheap restaurant');

      expect(res.status).toBe(200);
      expect(res.body.aiParsed).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(res.body.signals.category).toBe('restaurant');
      expect(res.body.signals.priceLevel).toBe(1);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.results[0].category).toBe('restaurant');
    });

    it('merges AI and synonym-table keywords, preferring the AI value when both set a category', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      // AI says restaurant; the query text's "hotel" would otherwise hint
      // category: hotel via the synonym table - the AI's value should win.
      global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
        category: 'restaurant', neighborhood: null, keywords: ['cozy'], minRating: null, priceLevel: null
      })));

      const res = await request(app).get('/api/destinations/smart-search?q=cozy hotel restaurant with a pool');

      expect(res.status).toBe(200);
      expect(res.body.signals.category).toBe('restaurant');
      // "pool" -> synonym keyword "pool", merged with the AI's "cozy".
      expect(res.body.signals.keywords).toEqual(expect.arrayContaining(['cozy', 'pool']));
    });
  });
});

describe('searchSynonyms.matchSignals()', () => {
  it('maps price phrasing to priceLevel', () => {
    expect(matchSignals('budget hotel').priceLevel).toBe(1);
    expect(matchSignals('something affordable').priceLevel).toBe(1);
    expect(matchSignals('mid-range restaurant').priceLevel).toBe(2);
    expect(matchSignals('a luxury stay').priceLevel).toBe(3);
    expect(matchSignals('an upscale, high-end spot').priceLevel).toBe(3);
    expect(matchSignals('no price cue here').priceLevel).toBeNull();
  });

  it('maps quality phrasing to minRating', () => {
    expect(matchSignals('best restaurant in town').minRating).toBe(4.0);
    expect(matchSignals('top-rated hotel').minRating).toBe(4.0);
    expect(matchSignals('somewhere decent').minRating).toBeNull();
  });

  it('maps category hints from the query text', () => {
    expect(matchSignals('a place to sleep tonight').category).toBe('hotel');
    expect(matchSignals('somewhere to eat').category).toBe('restaurant');
    expect(matchSignals('ice cream nearby').category).toBe('ice_cream');
    expect(matchSignals('need to go shopping').category).toBe('mall');
    expect(matchSignals('need gas for the car').category).toBe('petrol_station');
    expect(matchSignals('a museum or things to do').category).toBe('fun_place');
    expect(matchSignals('asdkfj qwerty').category).toBeNull();
  });

  it('maps vibe/amenity phrasing to tag keywords', () => {
    expect(matchSignals('somewhere family-friendly')).toMatchObject({
      keywords: expect.arrayContaining(['family-friendly', 'kids'])
    });
    expect(matchSignals('a quiet, romantic spot').keywords).toEqual(
      expect.arrayContaining(['quiet', 'romantic'])
    );
    expect(matchSignals('rooftop view please').keywords).toEqual(
      expect.arrayContaining(['view', 'rooftop'])
    );
    expect(matchSignals('somewhere with a pool').keywords).toContain('pool');
    expect(matchSignals('open late, 24hr').keywords).toContain('24hr');
    expect(matchSignals('outdoor terrace seating').keywords).toContain('outdoor-seating');
  });

  it('uses word boundaries so a short phrase does not false-positive inside another word', () => {
    // "eat" must not match inside "great"; "top" must not match inside "desktop".
    expect(matchSignals('a great vibe').category).not.toBe('restaurant');
    expect(matchSignals('a great vibe').minRating).toBe(4.0);
    expect(matchSignals('bring your own desktop').category).not.toBe('fun_place');
    // But a standalone word still matches.
    expect(matchSignals("let's eat something").category).toBe('restaurant');
  });
});

describe('searchRanking.rankDestinations()', () => {
  function place(overrides) {
    return {
      id: 'x', name: 'Place', category: 'hotel', neighborhood: 'Centre',
      description: '', tags: [], rating: null, priceLevel: null, ...overrides
    };
  }

  it('scores category + priceLevel + rating + keyword matches and ranks the best first', () => {
    const destinations = [
      place({ id: 'a', name: 'A', category: 'hotel', priceLevel: 3, rating: 4, tags: ['pool'] }),
      place({ id: 'b', name: 'B', category: 'hotel', priceLevel: 1, rating: 5 }),
      place({ id: 'c', name: 'C', category: 'restaurant', priceLevel: 3, rating: 5 })
    ];
    const signals = { category: 'hotel', neighborhood: null, priceLevel: 3, minRating: null, keywords: ['pool'] };

    const { results, fallback } = rankDestinations(destinations, signals);

    expect(fallback).toBeNull();
    // "A" gets category(40) + priceLevel(20) + tag-keyword(10) + rating*2(8) = 78,
    // easily ahead of "B" (category 40 + rating*2 10 = 50) and "C" (rating*2 10 only, wrong category).
    expect(results[0].id).toBe('a');
    expect(scoreDestination(destinations[0], signals)).toBeGreaterThan(scoreDestination(destinations[1], signals));
  });

  it('never excludes a destination for missing priceLevel data (no penalty, just no bonus)', () => {
    const destinations = [place({ id: 'a', priceLevel: null, rating: 4 })];
    const signals = { category: null, neighborhood: null, priceLevel: 2, minRating: null, keywords: [] };

    const { results } = rankDestinations(destinations, signals);
    expect(results).toHaveLength(1);
  });

  it('falls back to "category-popular" when the requested category has zero matching destinations', () => {
    // Note: because a category match alone is worth +40 (score > 0), the
    // only way for EVERY destination to score 0 while a category is set
    // is for that category to have zero destinations in the list at all
    // - which also means the fallback's own "top 5 in that category" is
    // empty. That's the one genuinely-empty case the ticket describes
    // ("the category itself genuinely has no places at all") - this
    // fallback branch exists for that case, not to conjure results up.
    const destinations = [
      place({ id: 'a', category: 'hotel', rating: null }),
      place({ id: 'b', category: 'hotel', rating: null }),
      place({ id: 'c', category: 'restaurant', rating: null })
    ];
    const signals = { category: 'petrol_station', neighborhood: null, priceLevel: null, minRating: null, keywords: [] };

    const { results, fallback } = rankDestinations(destinations, signals);

    expect(fallback).toBe('category-popular');
    expect(results).toHaveLength(0);
  });

  it('falls back to "popular" (top rated overall) when nothing scores above 0 and no category was requested', () => {
    const destinations = [
      place({ id: 'a', category: 'hotel', rating: null }),
      place({ id: 'b', category: 'restaurant', rating: null })
    ];
    const signals = { category: null, neighborhood: null, priceLevel: null, minRating: null, keywords: [] };

    const { results, fallback } = rankDestinations(destinations, signals);

    expect(fallback).toBe('popular');
    expect(results).toHaveLength(2);
  });

  it('caps the normal (non-fallback) result list at 20', () => {
    const destinations = Array.from({ length: 30 }, (_, i) => place({ id: `d${i}`, rating: 4 }));
    const signals = { category: null, neighborhood: null, priceLevel: null, minRating: null, keywords: [] };

    const { results, fallback } = rankDestinations(destinations, signals);

    expect(fallback).toBeNull();
    expect(results).toHaveLength(20);
  });
});
