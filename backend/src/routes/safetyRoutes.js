const express = require('express');
const path = require('path');
const { getMode, trackJson } = require('../controllers/safetyController');

// Public safety endpoints — no login. The guardian link is a capability
// URL: whoever has the token can follow that one ride until it expires.
const api = express.Router();
api.get('/safety/mode', getMode);
api.get('/track/:token', trackJson);

const page = express.Router();
page.get('/track/:token', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.sendFile(path.join(__dirname, '..', 'public', 'track.html'));
});

module.exports = { api, page };
