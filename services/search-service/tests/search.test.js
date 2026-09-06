const request = require('supertest');
const {
  createTestApp, installFetchMock, clearFetchMock, chatCompletion
} = require('./helpers/testApp');

describe('GET /api/search (Groq-backed)', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    clearFetchMock();
    delete process.env.GROQ_API_KEY;
  });

  it('rejects a missing query with 400', async () => {
    installFetchMock();
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
  });

  it('503s when destinations-service is unreachable', async () => {
    installFetchMock({ destinations: new Error('ECONNREFUSED') });
    const res = await request(app).get('/api/search?q=pizza');
    expect(res.status).toBe(503);
  });

  it('with no GROQ_API_KEY: plain substring search, understood = null', async () => {
    installFetchMock();
    const res = await request(app).get('/api/search?q=pizza');

    expect(res.status).toBe(200);
    expect(res.body.understood).toBeNull();
    expect(res.body.results.every((d) => (
      `${d.name} ${d.description} ${(d.tags || []).join(' ')}`.toLowerCase().includes('pizza')
    ))).toBe(true);
    expect(res.body.results.some((d) => d.name === 'Seven Hills')).toBe(true);
    const calledGroq = global.fetch.mock.calls.some(([u]) => String(u).includes('api.groq.com'));
    expect(calledGroq).toBe(false);
  });

  it('with a working GROQ key: uses the parsed { category, keywords } to rank', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    installFetchMock({
      groq: chatCompletion(JSON.stringify({ category: 'hotel', keywords: ['pool'] }))
    });

    const res = await request(app).get('/api/search?q=hotel with a pool');

    expect(res.status).toBe(200);
    expect(res.body.understood).toEqual({ category: 'hotel', keywords: ['pool'] });
    expect(res.body.results.every((d) => d.category === 'hotel')).toBe(true);
    expect(res.body.results[0].name).toBe('Mansel Hotel'); // the only hotel with "pool"
  });

  it('degrades to substring search (understood null) when the Groq call fails', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    installFetchMock({ groq: new Error('rate limited') });

    const res = await request(app).get('/api/search?q=pizza');

    expect(res.status).toBe(200);
    expect(res.body.understood).toBeNull();
    expect(res.body.results.some((d) => d.name === 'Seven Hills')).toBe(true);
  });
});
