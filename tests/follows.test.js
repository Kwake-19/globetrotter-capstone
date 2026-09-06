const request = require('supertest');
const { createTestApp, registerUser, follow } = require('./helpers/testApp');

describe('Follows', () => {
  let app;
  let cleanup;

  beforeAll(() => {
    ({ app, cleanup } = createTestApp());
  });

  afterAll(() => cleanup());

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  it('follows a user, reflected in both directions with relation flags', async () => {
    const a = await registerUser(app, { name: 'Alice A', username: 'alice_a' });
    const b = await registerUser(app, { name: 'Bob B', username: 'bob_b' });

    const res = await follow(app, a, b.user.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ following: true, mutual: false });

    const bFollowers = await request(app).get(`/api/users/${b.user.id}/followers`).set(auth(b.token));
    expect(bFollowers.body.results.map((u) => u.id)).toContain(a.user.id);
    expect(bFollowers.body.results.find((u) => u.id === a.user.id).followsYou).toBe(true);

    const aFollowing = await request(app).get(`/api/users/${a.user.id}/following`).set(auth(a.token));
    expect(aFollowing.body.results.map((u) => u.id)).toContain(b.user.id);
    expect(aFollowing.body.results[0]).not.toHaveProperty('email');
  });

  it('follow is idempotent and unfollow removes it', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);

    await follow(app, a, b.user.id);
    await follow(app, a, b.user.id); // again
    const following = await request(app).get(`/api/users/${a.user.id}/following`).set(auth(a.token));
    expect(following.body.results.filter((u) => u.id === b.user.id)).toHaveLength(1);

    const del = await request(app).delete(`/api/users/${b.user.id}/follow`).set(auth(a.token));
    expect(del.status).toBe(204);
    const after = await request(app).get(`/api/users/${a.user.id}/following`).set(auth(a.token));
    expect(after.body.results.map((u) => u.id)).not.toContain(b.user.id);
  });

  it('rejects following yourself (400) and an unknown user (404)', async () => {
    const a = await registerUser(app);
    const self = await request(app).post(`/api/users/${a.user.id}/follow`).set(auth(a.token));
    expect(self.status).toBe(400);

    const ghost = await request(app).post('/api/users/nope/follow').set(auth(a.token));
    expect(ghost.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/users?q=alice');
    expect(res.status).toBe(401);
  });

  it('searches users by username and name substring, excluding self', async () => {
    const me = await registerUser(app, { name: 'Searcher', username: 'searcher_me' });
    const target = await registerUser(app, { name: 'Zaza Zebra', username: 'zaza_z' });
    await follow(app, target, me.user.id); // target follows me

    const byUsername = await request(app).get('/api/users?q=zaza_z').set(auth(me.token));
    expect(byUsername.body.results.map((u) => u.id)).toContain(target.user.id);
    expect(byUsername.body.results.find((u) => u.id === target.user.id)).toMatchObject({
      youFollow: false, followsYou: true
    });

    const byName = await request(app).get('/api/users?q=zebra').set(auth(me.token));
    expect(byName.body.results.map((u) => u.id)).toContain(target.user.id);

    const self = await request(app).get('/api/users?q=searcher').set(auth(me.token));
    expect(self.body.results.map((u) => u.id)).not.toContain(me.user.id);

    const empty = await request(app).get('/api/users?q=').set(auth(me.token));
    expect(empty.status).toBe(400);
  });

  it('batch follow status reflects mutual / one-way / none', async () => {
    const me = await registerUser(app);
    const mutual = await registerUser(app);
    const oneWay = await registerUser(app);
    const stranger = await registerUser(app);

    await follow(app, me, mutual.user.id);
    await follow(app, mutual, me.user.id);
    await follow(app, me, oneWay.user.id);

    const res = await request(app)
      .get(`/api/follows/status?ids=${[mutual, oneWay, stranger].map((u) => u.user.id).join(',')}`)
      .set(auth(me.token));

    expect(res.body.status[mutual.user.id]).toEqual({ youFollow: true, followsYou: true });
    expect(res.body.status[oneWay.user.id]).toEqual({ youFollow: true, followsYou: false });
    expect(res.body.status[stranger.user.id]).toEqual({ youFollow: false, followsYou: false });
  });
});
