const User = require('../models/User');
const { toPublicUser } = require('./authController');

// Toggling availability is the driver-side equivalent of the car being
// "available" in Sec. II-B.2.d, where the request search only considers
// "available cars".
async function setAvailability(req, res, next) {
  try {
    const { isAvailable } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable: Boolean(isAvailable) },
      { new: true }
    );
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

module.exports = { setAvailability };
