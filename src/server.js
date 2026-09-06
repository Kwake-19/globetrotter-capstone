require('dotenv').config();
const http = require('http');
const { createApp } = require('./app');
const { attachSocketServer } = require('./realtime');

const PORT = process.env.PORT || 4001;

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set - copy .env.example to .env before running in anything but local dev.');
}

const app = createApp();

// Wrap Express in a bare HTTP server so Socket.io can share the same port
// (realtime 1-to-1 messaging - see src/realtime.js).
const server = http.createServer(app);
attachSocketServer(server, app);

server.listen(PORT, () => {
  console.log(`GlobeTrotter monolith listening on http://localhost:${PORT}`);
});
