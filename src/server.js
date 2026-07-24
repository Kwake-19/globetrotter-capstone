require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Create a .env file from .env.example before starting the server.');
  process.exit(1);
}

const { createApp } = require('./app');

const app = createApp();
const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`GlobeTrotter server listening on http://localhost:${port}`);
});
