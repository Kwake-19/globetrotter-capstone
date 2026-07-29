const request = require('supertest');
const { createTestApp, registerUser } = require('./helpers/testApp');

describe('Itineraries', () => {
  let app;
  let cleanup;
  let firstDestinationId;

  beforeAll(async () => {
    ({ app, cleanup } = createTestApp());
    const list = await request(app).get('/api/destinations');
    firstDestinationId = list.body.results[0].id;
  });

  afterAll(() => {
    cleanup();
  });

  it('blocks unauthenticated access with 401', async () => {
    const res = await request(app).get('/api/itineraries');
    expect(res.status).toBe(401);
  });

  it('creates an itinerary for the logged-in user', async () => {
    const { token } = await registerUser(app);

    const res = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Weekend in Yaounde', items: [{ destinationId: firstDestinationId, notes: 'Lunch here' }] });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Weekend in Yaounde');
    expect(res.body.items).toHaveLength(1);
  });

  it('rejects an itinerary with an unknown destinationId', async () => {
    const { token } = await registerUser(app);

    const res = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bad Trip', items: [{ destinationId: 'nope' }] });

    expect(res.status).toBe(400);
  });

  it('only returns the current user\'s itineraries, not other users\'', async () => {
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ title: 'User A trip', items: [{ destinationId: firstDestinationId }] });

    const resB = await request(app)
      .get('/api/itineraries')
      .set('Authorization', `Bearer ${userB.token}`);

    expect(resB.status).toBe(200);
    expect(resB.body.results).toHaveLength(0);
  });

  it('updates an itinerary title', async () => {
    const { token } = await registerUser(app);
    const created = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Original title', items: [{ destinationId: firstDestinationId }] });

    const res = await request(app)
      .put(`/api/itineraries/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
  });

  it('deletes an itinerary', async () => {
    const { token } = await registerUser(app);
    const created = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To delete', items: [{ destinationId: firstDestinationId }] });

    const del = await request(app)
      .delete(`/api/itineraries/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const getAfter = await request(app)
      .get(`/api/itineraries/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getAfter.status).toBe(404);
  });

  it('shares an itinerary and makes it viewable without auth', async () => {
    const { token } = await registerUser(app);
    const created = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Shareable trip', items: [{ destinationId: firstDestinationId }] });

    const shareRes = await request(app)
      .post(`/api/itineraries/${created.body.id}/share`)
      .set('Authorization', `Bearer ${token}`);
    expect(shareRes.status).toBe(200);
    expect(shareRes.body.shareId).toEqual(expect.any(String));

    const publicRes = await request(app).get(`/api/shared/${shareRes.body.shareId}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.title).toBe('Shareable trip');
    expect(publicRes.body.items[0].destination.id).toBe(firstDestinationId);
  });
});
