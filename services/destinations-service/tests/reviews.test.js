const request = require('supertest');
const { createTestApp, asUser, asAdmin } = require('./helpers/testApp');

describe('Reviews', () => {
  let app;
  let cleanup;
  let destinationId;

  beforeAll(async () => {
    ({ app, cleanup } = createTestApp());
    const list = await request(app).get('/api/destinations');
    destinationId = list.body.results[0].id;
  });

  afterAll(() => cleanup());

  describe('POST /api/destinations/:id/reviews', () => {
    it('requires a user (401 without X-User-Id)', async () => {
      const res = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .send({ rating: 5, text: 'Great place' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown destination', async () => {
      const res = await request(app)
        .post('/api/destinations/does-not-exist/reviews')
        .set(asUser().headers)
        .send({ rating: 5, text: 'Great place' });
      expect(res.status).toBe(404);
    });

    it.each([
      [0, 'Too low'],
      [6, 'Too high'],
      [3.5, 'Not an integer'],
      [undefined, 'Missing']
    ])('rejects an invalid rating %p (%s) with 400', async (rating) => {
      const res = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(asUser().headers)
        .send({ rating, text: 'Some review text' });
      expect(res.status).toBe(400);
    });

    it('rejects empty text with 400', async () => {
      const res = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 4, text: '   ' });
      expect(res.status).toBe(400);
    });

    it('rejects text over 500 characters with 400', async () => {
      const res = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 4, text: 'x'.repeat(501) });
      expect(res.status).toBe(400);
    });

    it('creates a review with the denormalized author name from X-User-Name', async () => {
      const user = asUser({ name: 'Amina Traveler' });
      const res = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(user.headers)
        .send({ rating: 5, text: 'Loved the pizza here!' });

      expect(res.status).toBe(201);
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.destinationId).toBe(destinationId);
      expect(res.body.userId).toBe(user.id);
      expect(res.body.userName).toBe('Amina Traveler');
      expect(res.body.rating).toBe(5);
      expect(res.body.text).toBe('Loved the pizza here!');
      expect(res.body.createdAt).toEqual(expect.any(String));
    });

    it('updates the existing review instead of creating a duplicate', async () => {
      const user = asUser();

      const first = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(user.headers)
        .send({ rating: 3, text: 'It was okay.' });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(user.headers)
        .send({ rating: 5, text: 'Actually, it grew on me!' });
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.rating).toBe(5);

      const listRes = await request(app).get(`/api/destinations/${destinationId}/reviews`);
      expect(listRes.body.results.filter((r) => r.id === first.body.id).length).toBe(1);
    });
  });

  describe('GET /api/destinations/:id/reviews', () => {
    it('returns 404 for an unknown destination', async () => {
      const res = await request(app).get('/api/destinations/does-not-exist/reviews');
      expect(res.status).toBe(404);
    });

    it('is public and returns reviews newest first', async () => {
      const destResult = await request(app).get('/api/destinations');
      const freshDestId = destResult.body.results[1].id;

      await request(app)
        .post(`/api/destinations/${freshDestId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 4, text: 'First review' });
      await request(app)
        .post(`/api/destinations/${freshDestId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 2, text: 'Second review' });

      const res = await request(app).get(`/api/destinations/${freshDestId}/reviews`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.results[0].text).toBe('Second review');
      expect(res.body.results[1].text).toBe('First review');
    });
  });

  describe('DELETE /api/destinations/:id/reviews/:reviewId', () => {
    it('requires a user (401)', async () => {
      const created = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 4, text: 'Review to delete' });

      const res = await request(app).delete(`/api/destinations/${destinationId}/reviews/${created.body.id}`);
      expect(res.status).toBe(401);
    });

    it('rejects deletion by someone who is neither the author nor an admin', async () => {
      const author = asUser();
      const stranger = asUser();

      const created = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(author.headers)
        .send({ rating: 4, text: 'Author-only review' });

      const res = await request(app)
        .delete(`/api/destinations/${destinationId}/reviews/${created.body.id}`)
        .set(stranger.headers);
      expect(res.status).toBe(403);
    });

    it('lets the author delete their own review', async () => {
      const author = asUser();
      const created = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(author.headers)
        .send({ rating: 4, text: 'Deleting my own review' });

      const res = await request(app)
        .delete(`/api/destinations/${destinationId}/reviews/${created.body.id}`)
        .set(author.headers);
      expect(res.status).toBe(204);

      const listRes = await request(app).get(`/api/destinations/${destinationId}/reviews`);
      expect(listRes.body.results.some((r) => r.id === created.body.id)).toBe(false);
    });

    it("lets an admin delete someone else's review", async () => {
      const author = asUser();
      const admin = asAdmin();

      const created = await request(app)
        .post(`/api/destinations/${destinationId}/reviews`)
        .set(author.headers)
        .send({ rating: 1, text: 'Reported review' });

      const res = await request(app)
        .delete(`/api/destinations/${destinationId}/reviews/${created.body.id}`)
        .set(admin.headers);
      expect(res.status).toBe(204);
    });

    it('returns 404 for an unknown review id', async () => {
      const res = await request(app)
        .delete(`/api/destinations/${destinationId}/reviews/does-not-exist`)
        .set(asUser().headers);
      expect(res.status).toBe(404);
    });
  });

  describe('userRatingAvg / userRatingCount', () => {
    it('is null/0 with no reviews, and computes correctly once reviews exist', async () => {
      const destResult = await request(app).get('/api/destinations');
      const freshDestId = destResult.body.results[2].id;

      const before = await request(app).get(`/api/destinations/${freshDestId}`);
      expect(before.body.userRatingAvg).toBeNull();
      expect(before.body.userRatingCount).toBe(0);
      const originalGoogleRating = before.body.rating;

      await request(app)
        .post(`/api/destinations/${freshDestId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 5, text: 'Excellent' });
      await request(app)
        .post(`/api/destinations/${freshDestId}/reviews`)
        .set(asUser().headers)
        .send({ rating: 3, text: 'Decent' });

      const after = await request(app).get(`/api/destinations/${freshDestId}`);
      expect(after.body.userRatingCount).toBe(2);
      expect(after.body.userRatingAvg).toBe(4);
      expect(after.body.rating).toBe(originalGoogleRating);

      const list = await request(app).get('/api/destinations');
      const listed = list.body.results.find((d) => d.id === freshDestId);
      expect(listed.userRatingAvg).toBe(4);
      expect(listed.userRatingCount).toBe(2);
    });
  });
});
