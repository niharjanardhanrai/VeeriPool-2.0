const express = require('express');
const { protect, requireRole } = require('../middleware/auth');
const {
  requestRide,
  myRides,
  getQueue,
  getRide,
  acceptRide,
  rejectRide,
  cancelRide,
  updateStage,
} = require('../controllers/rideController');
const { listMessages, sendMessage } = require('../controllers/messageController');
const { respond, sos, share } = require('../controllers/safetyController');

const router = express.Router();

router.use(protect);

router.post('/', requireRole('rider'), requestRide);
router.get('/mine', myRides);
router.get('/queue', requireRole('driver'), getQueue);
router.get('/:id', getRide);
router.post('/:id/accept', requireRole('driver'), acceptRide);
router.post('/:id/reject', requireRole('driver'), rejectRide);
router.post('/:id/cancel', requireRole('rider'), cancelRide);
router.post('/:id/stage', requireRole('driver'), updateStage);
router.get('/:id/messages', listMessages);
router.post('/:id/messages', sendMessage);
router.post('/:id/safety/respond', requireRole('rider'), respond);
router.post('/:id/safety/sos', requireRole('rider'), sos);
router.post('/:id/share', requireRole('rider'), share);

module.exports = router;
