const express = require('express');
const { protect, requireRole } = require('../middleware/auth');
const {
  planOffer,
  createOffer,
  searchOffers,
  myOffers,
  getOffer,
  bookSeat,
  cancelBooking,
  updateOfferStatus,
} = require('../controllers/offerController');

const router = express.Router();

router.use(protect);

router.post('/plan', requireRole('driver'), planOffer);
router.post('/', requireRole('driver'), createOffer);
router.get('/search', requireRole('rider'), searchOffers);
router.get('/mine', myOffers);
router.get('/:id', getOffer);
router.post('/:id/book', requireRole('rider'), bookSeat);
router.post('/:id/cancel-booking', requireRole('rider'), cancelBooking);
router.post('/:id/status', requireRole('driver'), updateOfferStatus);

module.exports = router;
