require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4002;

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set - copy .env.example to .env before running in anything but local dev.');
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`Itinerary service listening on http://localhost:${PORT}`);
});
