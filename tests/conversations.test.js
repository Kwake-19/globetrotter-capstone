const request = require('supertest');
const { createTestApp, registerUser, follow, mutualFollow } = require('./helpers/testApp');

describe('Conversations & messaging (REST)', () => {
  let app;
  let cleanup;
  let dest;

  beforeAll(async () => {
    ({ app, cleanup } = createTestApp());
    const list = await request(app).get('/api/destinations');
    dest = list.body.results[0];
  });

  afterAll(() => cleanup());

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  function send(token, body) {
    return request(app).post('/api/conversations/messages').set(auth(token)).send(body);
  }

  it('mutual follows can exchange messages; history is oldest-first', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await mutualFollow(app, a, b);

    const first = await send(a.token, { toUserId: b.user.id, type: 'text', text: 'hey B' });
    expect(first.status).toBe(201);
    const conversationId = first.body.conversationId;

    await send(b.token, { conversationId, type: 'text', text: 'hi A' });
    await send(a.token, { conversationId, type: 'text', text: 'how are you' });

    const historyA = await request(app).get(`/api/conversations/${conversationId}/messages`).set(auth(a.token));
    expect(historyA.body.results.map((m) => m.text)).toEqual(['hey B', 'hi A', 'how are you']);

    const listB = await request(app).get('/api/conversations').set(auth(b.token));
    expect(listB.body.results).toHaveLength(1);
    expect(listB.body.results[0].otherUser.id).toBe(a.user.id);
    expect(listB.body.results[0].lastMessage.preview).toBe('how are you');
  });

  it('a one-way follow cannot start a conversation (403)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await follow(app, a, b.user.id); // only a -> b

    const res = await send(a.token, { toUserId: b.user.id, type: 'text', text: 'hello?' });
    expect(res.status).toBe(403);
  });

  it('a non-participant cannot read a conversation (404)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    await mutualFollow(app, a, b);

    const msg = await send(a.token, { toUserId: b.user.id, type: 'text', text: 'private' });
    const res = await request(app).get(`/api/conversations/${msg.body.conversationId}/messages`).set(auth(c.token));
    expect(res.status).toBe(404);
  });

  it('validates place messages and enriches them on read', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await mutualFollow(app, a, b);
    const conv = (await send(a.token, { toUserId: b.user.id, type: 'text', text: 'start' })).body.conversationId;

    const bad = await send(a.token, { conversationId: conv, type: 'place', destinationId: 'nope' });
    expect(bad.status).toBe(400);

    const good = await send(a.token, { conversationId: conv, type: 'place', destinationId: dest.id });
    expect(good.status).toBe(201);

    const history = await request(app).get(`/api/conversations/${conv}/messages`).set(auth(b.token));
    const placeMsg = history.body.results.find((m) => m.type === 'place');
    expect(placeMsg.place).toMatchObject({ id: dest.id, name: dest.name });
  });

  it('shares an itinerary with a shareId and enriches it on read; blocks sharing a trip you do not own', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await mutualFollow(app, a, b);
    const conv = (await send(a.token, { toUserId: b.user.id, type: 'text', text: 'start' })).body.conversationId;

    const itin = (await request(app)
      .post('/api/itineraries')
      .set(auth(a.token))
      .send({ title: 'Shared via chat', items: [{ destinationId: dest.id }] })).body;

    const shared = await send(a.token, { conversationId: conv, type: 'itinerary', itineraryId: itin.id });
    expect(shared.status).toBe(201);
    expect(shared.body.message.shareId).toEqual(expect.any(String));

    const history = await request(app).get(`/api/conversations/${conv}/messages`).set(auth(b.token));
    const itinMsg = history.body.results.find((m) => m.type === 'itinerary');
    expect(itinMsg.itinerary).toMatchObject({ title: 'Shared via chat', shareId: shared.body.message.shareId });

    const notOwner = await send(b.token, { conversationId: conv, type: 'itinerary', itineraryId: itin.id });
    expect(notOwner.status).toBe(403);
  });

  it('GET /api/conversations/recipients returns only mutual follows', async () => {
    const me = await registerUser(app);
    const mutual = await registerUser(app, { username: 'the_mutual' });
    const oneWay = await registerUser(app, { username: 'the_oneway' });
    await mutualFollow(app, me, mutual);
    await follow(app, me, oneWay.user.id);

    const res = await request(app).get('/api/conversations/recipients').set(auth(me.token));
    const ids = res.body.results.map((u) => u.id);
    expect(ids).toContain(mutual.user.id);
    expect(ids).not.toContain(oneWay.user.id);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });
});
