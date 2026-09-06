require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4006;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Chatbot service listening on http://localhost:${PORT}`);
});
