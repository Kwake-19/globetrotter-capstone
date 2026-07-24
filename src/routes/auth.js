const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

router.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  const trimmedUsername = typeof username === 'string' ? username.trim() : '';

  if (!trimmedUsername || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  if (db.getUserByUsername(trimmedUsername)) {
    return res.status(409).json({ error: 'username already exists' });
  }

  const user = {
    id: db.uuidv4(),
    username: trimmedUsername,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  db.saveUser(user);

  return res.status(201).json({ message: 'user registered successfully', username: user.username });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = jwt.sign({ sub: user.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
  return res.status(200).json({ token });
});

module.exports = router;
