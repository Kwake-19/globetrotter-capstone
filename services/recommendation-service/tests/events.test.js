const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');

describe('Itinerary event handling', () => {
  let app;
  let cleanup;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    await cleanup();
  });

  it('increments timesAdded for destinations referenced by an itinerary.created event', async () => {
    const { handleItineraryEvent } = require('../src/events/consumer');
    const list = await request(app).get('/api/destinations');
    const targetId = list.body.results[0].id;
    const before = list.body.results[0].timesAdded || 0;

    await handleItineraryEvent({
      itineraryId: 'it-1',
      userId: 'user-1',
      destinationIds: [targetId, targetId]
    });

    const after = await request(app).get(`/api/destinations/${targetId}`);
    expect(after.body.timesAdded).toBe(before + 2);
  });
});
