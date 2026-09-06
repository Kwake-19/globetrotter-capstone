require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set - the gateway cannot verify tokens. Copy .env.example to .env before running outside local dev.');
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`API Gateway listening on http://localhost:${PORT}`);
});
