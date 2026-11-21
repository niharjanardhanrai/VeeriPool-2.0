const express = require('express');
const { body, validationResult } = require('express-validator');
const { register, login, me, verifyOtp, resendOtp } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { uploadLicense } = require('../middleware/upload');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
  }
  next();
}

router.post(
  '/register',
  uploadLicense.single('license'),
  [
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('universityId').trim().notEmpty().withMessage('University ID is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['rider', 'driver']).withMessage('role must be rider or driver'),
    body('vehicleSeatsTotal')
      .if(body('role').equals('driver'))
      .isInt({ min: 1, max: 8 })
      .withMessage('Drivers must provide a seat count between 1 and 8'),
  ],
  validate,
  register
);

router.post(
  '/verify-otp',
  [
    body('code').trim().isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit code'),
    body().custom((value) => {
      if (!value.username && !value.email) throw new Error('username or email is required');
      return true;
    }),
  ],
  validate,
  verifyOtp
);

router.post('/resend-otp', resendOtp);

router.post(
  '/login',
  [
    body('password').notEmpty().withMessage('Password is required'),
    body().custom((value) => {
      if (!value.username && !value.email) {
        throw new Error('username or email is required');
      }
      return true;
    }),
  ],
  validate,
  login
);

router.get('/me', protect, me);

module.exports = router;
