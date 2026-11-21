const express = require('express');
const {
  getMyMessages,
  sendMyMessage,
  listThreads,
  getThread,
  replyToThread,
} = require('../controllers/supportController');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// Riders and drivers: their own thread with customer care.
router.get('/messages', requireRole('rider', 'driver'), getMyMessages);
router.post('/messages', requireRole('rider', 'driver'), sendMyMessage);

// Admins act as support agents across every thread.
router.get('/threads', requireRole('admin'), listThreads);
router.get('/threads/:userId', requireRole('admin'), getThread);
router.post('/threads/:userId', requireRole('admin'), replyToThread);

module.exports = router;
