require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4003;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Search service listening on http://localhost:${PORT}`);
});
