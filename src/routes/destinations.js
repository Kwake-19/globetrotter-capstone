const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/destinations', (req, res) => {
  return res.status(200).json(db.getDestinations());
});

module.exports = router;
