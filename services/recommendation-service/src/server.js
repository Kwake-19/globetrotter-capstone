require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4005;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Recommendation service listening on http://localhost:${PORT}`);
});
