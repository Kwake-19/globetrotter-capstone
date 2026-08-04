const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('Search', () => {
  let app;
  let cleanup;
  let originalKey;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = originalKey;
    }
  });

  it('rejects a missing query with 400', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
  });

  it('falls back to plain substring search when no GROQ_API_KEY is configured', async () => {
    const list = await request(app).get('/api/destinations');
    const sampleName = list.body.results[0].name.split(' ')[0];

    const res = await request(app).get(`/api/search?q=${encodeURIComponent(sampleName)}`);
    expect(res.status).toBe(200);
    expect(res.body.understood).toBeNull();
    expect(res.body.results.some((p) => p.name.includes(sampleName))).toBe(true);
  });
});
