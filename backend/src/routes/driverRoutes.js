const express = require('express');
const { protect, requireRole } = require('../middleware/auth');
const { setAvailability } = require('../controllers/driverController');

const router = express.Router();

router.use(protect, requireRole('driver'));

router.post('/availability', setAvailability);

module.exports = router;
