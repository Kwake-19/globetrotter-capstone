const request = require('supertest');
const { createTestApp, installFetchMock, clearFetchMock } = require('./helpers/testApp');

describe('POST /api/chatbot', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    clearFetchMock();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('rejects a missing message with 400 (no downstream calls)', async () => {
    installFetchMock();
    const res = await request(app).post('/api/chatbot').send({});
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an over-long message with 400', async () => {
    installFetchMock();
    const res = await request(app).post('/api/chatbot').send({ message: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('503s when search-service is unreachable', async () => {
    installFetchMock({ search: new Error('ECONNREFUSED') });
    const res = await request(app).post('/api/chatbot').send({ message: 'where can I eat?' });
    expect(res.status).toBe(503);
  });

  it('with a working OpenRouter key: returns the AI reply plus suggestedPlaces from search-service', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    installFetchMock({ openrouterContent: 'I recommend Seven Hills in Bastos for dinner.' });

    const res = await request(app).post('/api/chatbot').send({ message: 'somewhere for dinner' });

    expect(res.status).toBe(200);
    expect(res.body.aiReply).toBe(true);
    expect(res.body.reply).toBe('I recommend Seven Hills in Bastos for dinner.');
    expect(res.body.suggestedPlaces.map((p) => p.name)).toEqual(['Seven Hills', 'Glacier Delice']);

    // chain order: search-service first, then OpenRouter
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toContain('/api/search');
    expect(urls[1]).toContain('openrouter.ai');
  });

  it('falls back to a templated reply (aiReply false) when no OPENROUTER_API_KEY is set', async () => {
    installFetchMock();
    const res = await request(app).post('/api/chatbot').send({ message: 'ice cream' });

    expect(res.status).toBe(200);
    expect(res.body.aiReply).toBe(false);
    expect(res.body.reply).toContain('Seven Hills');
    expect(res.body.suggestedPlaces).toHaveLength(2);
    // OpenRouter was never called
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('openrouter.ai'))).toBe(false);
  });

  it('falls back to a templated reply when the OpenRouter call fails', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    installFetchMock({ openrouterContent: new Error('network down') });

    const res = await request(app).post('/api/chatbot').send({ message: 'dinner' });

    expect(res.status).toBe(200);
    expect(res.body.aiReply).toBe(false);
    expect(res.body.reply).toContain('Seven Hills');
  });

  it('handles a no-results search gracefully', async () => {
    installFetchMock({ search: [] });
    const res = await request(app).post('/api/chatbot').send({ message: 'underwater basket weaving' });

    expect(res.status).toBe(200);
    expect(res.body.suggestedPlaces).toEqual([]);
    expect(res.body.reply).toMatch(/couldn't find/i);
  });
});
