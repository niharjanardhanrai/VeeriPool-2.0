const express = require('express');
const { listFlagged, listRecent, approve, reject } = require('../controllers/adminController');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(protect, requireRole('admin'));

router.get('/flagged', listFlagged);
router.get('/recent', listRecent);
router.post('/users/:id/approve', approve);
router.post('/users/:id/reject', reject);

module.exports = router;
