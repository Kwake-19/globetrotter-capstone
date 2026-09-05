const amqp = require('amqplib');
const { readDB, writeDB } = require('../utils/dataStore');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE = 'globetrotter.events';
const QUEUE = 'recommendation-service.itinerary-events';
const RECONNECT_DELAY_MS = 5000;

/**
 * Asynchronous, event-driven side of the architecture diagram: rather than
 * Itinerary Service calling us synchronously every time a trip changes, we
 * subscribe to its events and update our own read model (a `timesAdded`
 * popularity counter per destination) whenever one arrives. This is the
 * "eventual consistency" trade-off from the slide's challenges list - the
 * counter lags slightly behind the itinerary that caused it, in exchange
 * for the two services staying decoupled.
 */
async function handleItineraryEvent(payload) {
  const { destinationIds } = payload;
  if (!Array.isArray(destinationIds) || destinationIds.length === 0) return;

  const db = await readDB();
  const countByDestinationId = {};
  destinationIds.forEach((id) => {
    countByDestinationId[id] = (countByDestinationId[id] || 0) + 1;
  });

  let changed = false;
  db.destinations.forEach((destination) => {
    const increment = countByDestinationId[destination.id];
    if (increment) {
      destination.timesAdded = (destination.timesAdded || 0) + increment;
      changed = true;
    }
  });

  if (changed) {
    await writeDB(db);
  }
}

async function connectAndConsume() {
  let connection;
  try {
    connection = await amqp.connect(RABBITMQ_URL);
  } catch (err) {
    console.warn(`[recommendation-service] RabbitMQ unavailable (${err.message}), retrying in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(connectAndConsume, RECONNECT_DELAY_MS);
    return;
  }

  connection.on('close', () => {
    console.warn('[recommendation-service] RabbitMQ connection closed, reconnecting...');
    setTimeout(connectAndConsume, RECONNECT_DELAY_MS);
  });
  connection.on('error', () => {});

  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  const queue = await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(queue.queue, EXCHANGE, 'itinerary.created');
  await channel.bindQueue(queue.queue, EXCHANGE, 'itinerary.updated');

  channel.consume(queue.queue, async (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      await handleItineraryEvent(payload);
      channel.ack(msg);
    } catch (err) {
      console.error('[recommendation-service] Failed to process itinerary event:', err.message);
      channel.nack(msg, false, false);
    }
  });

  console.log('[recommendation-service] Subscribed to itinerary.created / itinerary.updated events');
}

/** Starts the consumer in the background - never blocks server startup. */
function startConsumer() {
  connectAndConsume();
}

module.exports = { startConsumer, handleItineraryEvent };
