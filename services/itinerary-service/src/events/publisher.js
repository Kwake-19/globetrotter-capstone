const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE = 'globetrotter.events';

/**
 * Fire-and-forget event publishing (async, event-driven communication from
 * the architecture diagram). Publishing must never block or fail the HTTP
 * request that triggered it - if RabbitMQ is down or still starting up, we
 * log a warning and keep retrying the connection in the background instead
 * of throwing.
 */
let channelPromise = null;

async function connect() {
  const connection = await amqp.connect(RABBITMQ_URL);
  connection.on('error', () => {});
  connection.on('close', () => {
    channelPromise = null;
    console.warn('[itinerary-service] RabbitMQ connection closed - will reconnect on next publish');
  });

  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  return channel;
}

function getChannel() {
  if (!channelPromise) {
    channelPromise = connect().catch((err) => {
      channelPromise = null;
      throw err;
    });
  }
  return channelPromise;
}

async function publishEvent(routingKey, payload) {
  try {
    const channel = await getChannel();
    channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json',
      persistent: true
    });
  } catch (err) {
    console.warn(`[itinerary-service] Failed to publish "${routingKey}" event:`, err.message);
  }
}

module.exports = { publishEvent };
