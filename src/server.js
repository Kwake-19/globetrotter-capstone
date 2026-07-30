require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4001;

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set - copy .env.example to .env before running in anything but local dev.');
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`GlobeTrotter monolith listening on http://localhost:${PORT}`);
});
