require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4004;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Itinerary service listening on http://localhost:${PORT}`);
});
