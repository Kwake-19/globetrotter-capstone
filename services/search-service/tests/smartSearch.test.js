const request = require('supertest');
const {
  createTestApp, installFetchMock, clearFetchMock, chatCompletion
} = require('./helpers/testApp');

describe('GET /api/destinations/smart-search', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    clearFetchMock();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('rejects a missing query with 400 (and never calls downstream)', async () => {
    installFetchMock();
    const res = await request(app).get('/api/destinations/smart-search');
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('503s when destinations-service is unreachable', async () => {
    installFetchMock({ destinations: new Error('ECONNREFUSED') });
    const res = await request(app).get('/api/destinations/smart-search?q=hotel');
    expect(res.status).toBe(503);
  });

  it('503s when destinations-service returns a 5xx', async () => {
    installFetchMock({ destinations: 500 });
    const res = await request(app).get('/api/destinations/smart-search?q=hotel');
    expect(res.status).toBe(503);
  });

  it('with no OPENROUTER_API_KEY: aiParsed false, ranks using the synonym table only', async () => {
    installFetchMock();
    const res = await request(app).get('/api/destinations/smart-search?q=cheap hotel');

    expect(res.status).toBe(200);
    expect(res.body.aiParsed).toBe(false);
    expect(res.body.signals.category).toBe('hotel');
    expect(res.body.signals.priceLevel).toBe(1);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.results[0].category).toBe('hotel');
    // never called OpenRouter
    const calledOpenRouter = global.fetch.mock.calls.some(([u]) => String(u).includes('openrouter.ai'));
    expect(calledOpenRouter).toBe(false);
  });

  it('with a working OPENROUTER key: aiParsed true and signals reflect the parse', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    installFetchMock({
      openrouter: chatCompletion(JSON.stringify({
        category: 'hotel', neighborhood: null, keywords: [], minRating: null, priceLevel: 3
      }))
    });

    const res = await request(app).get('/api/destinations/smart-search?q=luxury hotels');

    expect(res.status).toBe(200);
    expect(res.body.aiParsed).toBe(true);
    expect(res.body.signals).toMatchObject({ category: 'hotel', priceLevel: 3 });
    // Mansel (priceLevel 3, rating 4.6) outranks La Falaise (priceLevel 3, rating 4.3)
    expect(res.body.results[0].name).toBe('Mansel Hotel');
    expect(res.body.results[1].name).toBe('La Falaise Hotel');
  });

  it('degrades to synonym-table signals (aiParsed false) when the OpenRouter call fails', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    installFetchMock({ openrouter: new Error('network down') });

    const res = await request(app).get('/api/destinations/smart-search?q=budget friendly hotels');

    expect(res.status).toBe(200);
    expect(res.body.aiParsed).toBe(false);
    expect(res.body.signals.category).toBe('hotel');
    expect(res.body.signals.priceLevel).toBe(1);
    expect(res.body.results[0].category).toBe('hotel');
  });

  it('passes destinations-service result objects straight through (shape preserved)', async () => {
    installFetchMock();
    const res = await request(app).get('/api/destinations/smart-search?q=pizza');
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toHaveProperty('userRatingCount');
    expect(res.body.results[0].name).toBe('Seven Hills'); // only place tagged "pizza"
  });
});
