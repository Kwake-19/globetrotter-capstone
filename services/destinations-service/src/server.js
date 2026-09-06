require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4002;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Destinations service listening on http://localhost:${PORT}`);
});
