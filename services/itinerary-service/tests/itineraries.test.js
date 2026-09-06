const request = require('supertest');
const { createTestApp, installFetchMock, clearFetchMock, asUser } = require('./helpers/testApp');

const DEST_ID = 'dest-001';

describe('Itineraries', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  beforeEach(() => installFetchMock());
  afterEach(() => clearFetchMock());

  it('blocks unauthenticated access with 401', async () => {
    const res = await request(app).get('/api/itineraries');
    expect(res.status).toBe(401);
  });

  it('creates an itinerary for the current user (validating ids against destinations-service)', async () => {
    const user = asUser();
    const res = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Weekend in Yaounde', items: [{ destinationId: DEST_ID, notes: 'Lunch here' }] });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Weekend in Yaounde');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.userId).toBe(user.id);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/destinations'));
  });

  it('rejects an itinerary with an unknown destinationId (400)', async () => {
    const res = await request(app)
      .post('/api/itineraries')
      .set(asUser().headers)
      .send({ title: 'Bad Trip', items: [{ destinationId: 'nope' }] });
    expect(res.status).toBe(400);
  });

  it('503s on create when destinations-service is unreachable', async () => {
    installFetchMock(new Error('ECONNREFUSED'));
    const res = await request(app)
      .post('/api/itineraries')
      .set(asUser().headers)
      .send({ title: 'Trip', items: [{ destinationId: DEST_ID }] });
    expect(res.status).toBe(503);
  });

  it("only returns the current user's itineraries", async () => {
    const userA = asUser();
    const userB = asUser();

    await request(app)
      .post('/api/itineraries')
      .set(userA.headers)
      .send({ title: 'User A trip', items: [{ destinationId: DEST_ID }] });

    const resB = await request(app).get('/api/itineraries').set(userB.headers);
    expect(resB.status).toBe(200);
    expect(resB.body.results).toHaveLength(0);
  });

  it('updates an itinerary title (no destinations call when items are unchanged)', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Original title', items: [{ destinationId: DEST_ID }] });

    global.fetch.mockClear();
    const res = await request(app)
      .put(`/api/itineraries/${created.body.id}`)
      .set(user.headers)
      .send({ title: 'Updated title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates itinerary items as unvisited by default and marks them visited via PATCH', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Checklist trip', items: [{ destinationId: DEST_ID }] });
    expect(created.body.items[0].visited).toBe(false);

    const res = await request(app)
      .patch(`/api/itineraries/${created.body.id}/items/${DEST_ID}`)
      .set(user.headers)
      .send({ visited: true });
    expect(res.status).toBe(200);
    expect(res.body.items[0].visited).toBe(true);
  });

  it('rejects a non-boolean visited value with 400', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Checklist trip', items: [{ destinationId: DEST_ID }] });

    const res = await request(app)
      .patch(`/api/itineraries/${created.body.id}/items/${DEST_ID}`)
      .set(user.headers)
      .send({ visited: 'yes' });
    expect(res.status).toBe(400);
  });

  it('returns 404 marking visited on a destination not in the itinerary', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Checklist trip', items: [{ destinationId: DEST_ID }] });

    const res = await request(app)
      .patch(`/api/itineraries/${created.body.id}/items/not-in-this-trip`)
      .set(user.headers)
      .send({ visited: true });
    expect(res.status).toBe(404);
  });

  it('preserves visited status across a PUT that keeps the same stop', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Checklist trip', items: [{ destinationId: DEST_ID }] });

    await request(app)
      .patch(`/api/itineraries/${created.body.id}/items/${DEST_ID}`)
      .set(user.headers)
      .send({ visited: true });

    const res = await request(app)
      .put(`/api/itineraries/${created.body.id}`)
      .set(user.headers)
      .send({ title: 'Renamed trip', items: [{ destinationId: DEST_ID }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0].visited).toBe(true);
  });

  it('deletes an itinerary', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'To delete', items: [{ destinationId: DEST_ID }] });

    const del = await request(app).delete(`/api/itineraries/${created.body.id}`).set(user.headers);
    expect(del.status).toBe(204);

    const getAfter = await request(app).get(`/api/itineraries/${created.body.id}`).set(user.headers);
    expect(getAfter.status).toBe(404);
  });
});

describe('Shared itineraries', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  beforeEach(() => installFetchMock());
  afterEach(() => clearFetchMock());

  it('shares an itinerary and makes it viewable without auth, enriched with destination details', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Shareable trip', items: [{ destinationId: DEST_ID }] });

    const shareRes = await request(app)
      .post(`/api/itineraries/${created.body.id}/share`)
      .set(user.headers);
    expect(shareRes.status).toBe(200);
    expect(shareRes.body.shareId).toEqual(expect.any(String));

    const publicRes = await request(app).get(`/api/shared/${shareRes.body.shareId}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.title).toBe('Shareable trip');
    expect(publicRes.body.items[0].destination.id).toBe(DEST_ID);
    expect(publicRes.body.items[0].destination.name).toBe('Seven Hills');
  });

  it('404s for an unknown shareId', async () => {
    const res = await request(app).get('/api/shared/no-such-share');
    expect(res.status).toBe(404);
  });

  it('503s the shared view when destinations-service is unreachable', async () => {
    const user = asUser();
    const created = await request(app)
      .post('/api/itineraries')
      .set(user.headers)
      .send({ title: 'Shareable trip', items: [{ destinationId: DEST_ID }] });
    const shareRes = await request(app)
      .post(`/api/itineraries/${created.body.id}/share`)
      .set(user.headers);

    installFetchMock(503);
    const publicRes = await request(app).get(`/api/shared/${shareRes.body.shareId}`);
    expect(publicRes.status).toBe(503);
  });
});
