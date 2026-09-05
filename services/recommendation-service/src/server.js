require('dotenv').config();
const { createApp } = require('./app');
const { startConsumer } = require('./events/consumer');

const PORT = process.env.PORT || 4003;

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set - copy .env.example to .env before running in anything but local dev.');
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`Recommendation service listening on http://localhost:${PORT}`);
});

// Runs independently of the HTTP server - a slow/unavailable RabbitMQ never
// delays accepting requests.
if (process.env.NODE_ENV !== 'test') {
  startConsumer();
}
