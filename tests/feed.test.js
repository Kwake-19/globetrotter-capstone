const request = require('supertest');
const { createTestApp, registerUser, follow } = require('./helpers/testApp');

describe('Feed & social recommendations', () => {
  let app;
  let cleanup;
  let destA;
  let destB;

  beforeAll(async () => {
    ({ app, cleanup } = createTestApp());
    const list = await request(app).get('/api/destinations');
    destA = list.body.results[0];
    destB = list.body.results[1];
  });

  afterAll(() => cleanup());

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function reviewPlace(user, destId, rating, text) {
    return request(app)
      .post(`/api/destinations/${destId}/reviews`)
      .set(auth(user.token))
      .send({ rating, text });
  }

  async function createItinerary(user, title, destIds) {
    const res = await request(app)
      .post('/api/itineraries')
      .set(auth(user.token))
      .send({ title, items: destIds.map((destinationId) => ({ destinationId })) });
    return res.body;
  }

  it('shows reviews and shared itineraries from people you follow, newest first', async () => {
    const me = await registerUser(app);
    const author = await registerUser(app, { name: 'Fatima Feed', username: 'fatima_feed' });
    await follow(app, me, author.user.id);

    await reviewPlace(author, destA.id, 5, 'Incredible spot');
    const itin = await createItinerary(author, 'Author trip', [destB.id]);
    await request(app).post(`/api/itineraries/${itin.id}/share`).set(auth(author.token));

    const feed = await request(app).get('/api/feed').set(auth(me.token));
    expect(feed.status).toBe(200);

    const review = feed.body.results.find((i) => i.type === 'review');
    expect(review.actor.username).toBe('fatima_feed');
    expect(review.destination.id).toBe(destA.id);
    expect(review.rating).toBe(5);

    const itinItem = feed.body.results.find((i) => i.type === 'itinerary');
    expect(itinItem.itinerary.title).toBe('Author trip');
    expect(itinItem.itinerary.shareId).toEqual(expect.any(String));
  });

  it('excludes unshared itineraries and non-followed users', async () => {
    const me = await registerUser(app);
    const followed = await registerUser(app);
    const notFollowed = await registerUser(app);
    await follow(app, me, followed.user.id);

    // followed user has an itinerary but never shares it
    await createItinerary(followed, 'Private plan', [destA.id]);
    // not-followed user reviews something
    await reviewPlace(notFollowed, destB.id, 4, 'Decent');

    const feed = await request(app).get('/api/feed').set(auth(me.token));
    expect(feed.body.results.some((i) => i.type === 'itinerary' && i.itinerary.title === 'Private plan')).toBe(false);
    expect(feed.body.results.some((i) => i.type === 'review' && i.actor.id === notFollowed.user.id)).toBe(false);
  });

  it('is empty when you follow nobody', async () => {
    const loner = await registerUser(app);
    const feed = await request(app).get('/api/feed').set(auth(loner.token));
    expect(feed.body.results).toEqual([]);
  });

  it('recommendations include fromFollowing with followedBy attribution', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app, { username: 'rec_friend' });
    await follow(app, me, friend.user.id);
    await reviewPlace(friend, destA.id, 5, 'Must visit');

    const recs = await request(app).get('/api/recommendations').set(auth(me.token));
    expect(recs.status).toBe(200);
    const hit = recs.body.fromFollowing.find((d) => d.id === destA.id);
    expect(hit).toBeTruthy();
    expect(hit.followedBy).toEqual([
      expect.objectContaining({ username: 'rec_friend', action: 'reviewed' })
    ]);
  });

  it('recommendations fromFollowing is [] for a guest', async () => {
    const recs = await request(app).get('/api/recommendations');
    expect(recs.body.fromFollowing).toEqual([]);
  });

  it('fromFollowing excludes destinations already in your own itineraries', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    await follow(app, me, friend.user.id);
    await reviewPlace(friend, destB.id, 5, 'Great');
    await createItinerary(me, 'My own trip', [destB.id]); // I already have destB

    const recs = await request(app).get('/api/recommendations').set(auth(me.token));
    expect(recs.body.fromFollowing.some((d) => d.id === destB.id)).toBe(false);
  });
});
