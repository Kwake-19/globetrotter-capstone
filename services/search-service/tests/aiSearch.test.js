/**
 * Pure unit tests for the three relocated ranking modules - no app, no
 * HTTP. Copied from the monolith's tests/aiSearch.test.js (the route-level
 * assertions that depended on real seed data live in smartSearch.test.js
 * against fixtures instead).
 */
const { parseSearchQuery } = require('../src/services/aiSearch');
const { matchSignals, extractKeywordTokens } = require('../src/services/searchSynonyms');
const { rankDestinations, scoreDestination } = require('../src/services/searchRanking');

const VALID_CATEGORIES = ['restaurant', 'ice_cream', 'mall', 'fun_place', 'hotel', 'petrol_station'];

function openRouterOk(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}

describe('aiSearch.parseSearchQuery()', () => {
  let originalFetch;
  let savedEnv;

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
      category: 'hotel', neighborhood: 'Bastos', keywords: ['Wifi', ' Pool '], minRating: 4, priceLevel: 3
    })));

    const result = await parseSearchQuery('best luxury hotel in bastos with wifi and a pool', VALID_CATEGORIES);

    expect(result).toEqual({
      category: 'hotel', neighborhood: 'Bastos', keywords: ['wifi', 'pool'], minRating: 4, priceLevel: 3
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('normalizes an out-of-range priceLevel to null', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(openRouterOk(JSON.stringify({
      category: null, neighborhood: null, keywords: [], minRating: null, priceLevel: 7
    })));

    const result = await parseSearchQuery('somewhere', VALID_CATEGORIES);
    expect(result.priceLevel).toBeNull();
  });

  it('retries once with the fallback model when the primary fails, then succeeds', async () => {
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

  it('throws AI_UNAVAILABLE when both models fail', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(parseSearchQuery('anything', VALID_CATEGORIES))
      .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws AI_UNAVAILABLE (does not crash) when the model response is not valid JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(openRouterOk('Sure! Here you go: {category: hotel}'));

    await expect(parseSearchQuery('a nice hotel', VALID_CATEGORIES))
      .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('searchSynonyms.matchSignals()', () => {
  it('maps price phrasing to priceLevel', () => {
    expect(matchSignals('budget hotel').priceLevel).toBe(1);
    expect(matchSignals('mid-range restaurant').priceLevel).toBe(2);
    expect(matchSignals('a luxury stay').priceLevel).toBe(3);
    expect(matchSignals('no price cue here').priceLevel).toBeNull();
  });

  it('maps quality phrasing to minRating', () => {
    expect(matchSignals('best restaurant in town').minRating).toBe(4.0);
    expect(matchSignals('somewhere decent').minRating).toBeNull();
  });

  it('maps category hints from the query text', () => {
    expect(matchSignals('a place to sleep tonight').category).toBe('hotel');
    expect(matchSignals('somewhere to eat').category).toBe('restaurant');
    expect(matchSignals('ice cream nearby').category).toBe('ice_cream');
    expect(matchSignals('need gas for the car').category).toBe('petrol_station');
    expect(matchSignals('asdkfj qwerty').category).toBeNull();
  });

  it('falls back to raw query tokens for unknown terms', () => {
    expect(matchSignals('pizza').keywords).toEqual(['pizza']);
    expect(matchSignals('good sushi place').keywords).toEqual(['sushi']);
  });

  it('uses word boundaries so a short phrase does not false-positive inside another word', () => {
    expect(matchSignals('a great vibe').category).not.toBe('restaurant');
    expect(matchSignals('a great vibe').minRating).toBe(4.0);
    expect(matchSignals("let's eat something").category).toBe('restaurant');
  });
});

describe('searchSynonyms.extractKeywordTokens()', () => {
  it('keeps substantive words and drops short/filler ones', () => {
    expect(extractKeywordTokens('find me a hotel')).toEqual(['hotel']);
    expect(extractKeywordTokens('pizza')).toEqual(['pizza']);
    expect(extractKeywordTokens('')).toEqual([]);
  });

  it('keeps hyphenated words intact as a single token', () => {
    expect(extractKeywordTokens('a zzz-no-such-word query')).toContain('zzz-no-such-word');
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
      place({ id: 'a', category: 'hotel', priceLevel: 3, rating: 4, tags: ['pool'] }),
      place({ id: 'b', category: 'hotel', priceLevel: 1, rating: 5 }),
      place({ id: 'c', category: 'restaurant', priceLevel: 3, rating: 5 })
    ];
    const signals = { category: 'hotel', neighborhood: null, priceLevel: 3, minRating: null, keywords: ['pool'] };

    const { results, fallback } = rankDestinations(destinations, signals);

    expect(fallback).toBeNull();
    expect(results[0].id).toBe('a');
    expect(scoreDestination(destinations[0], signals)).toBeGreaterThan(scoreDestination(destinations[1], signals));
  });

  it('awards +3 per keyword found in review text', () => {
    const destination = place({ id: 'a', tags: [], description: '' });
    const signals = { category: null, neighborhood: null, priceLevel: null, minRating: null, keywords: ['sunset'] };
    const withoutReview = scoreDestination(destination, signals);
    const withReview = scoreDestination(destination, signals, 'Amazing sunset views from the terrace.');
    expect(withReview - withoutReview).toBe(3);
  });

  it('never excludes a destination for missing priceLevel data', () => {
    const destinations = [place({ id: 'a', priceLevel: null, rating: 4 })];
    const signals = { category: null, neighborhood: null, priceLevel: 2, minRating: null, keywords: [] };
    const { results } = rankDestinations(destinations, signals);
    expect(results).toHaveLength(1);
  });

  it('falls back to "popular" when nothing scores above 0 and no category was requested', () => {
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
