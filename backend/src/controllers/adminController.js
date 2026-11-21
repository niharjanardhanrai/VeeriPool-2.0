const User = require('../models/User');
const { toPublicUser } = require('./authController');
const { sendAccountDecisionEmail } = require('../services/mailer');

// Automated version of Sec. II-B.1.b "Validation Process": riders and
// license-verified drivers never reach this screen at all (see
// authController.verifyOtp) — only drivers whose automated check couldn't
// confidently pass or fail land here, each with the reason shown, for a
// human admin to make the actual call. This is the fallback for whatever
// the automation can't resolve, not a routine step.
async function listFlagged(req, res, next) {
  try {
    const users = await User.find({ status: 'flagged' }).sort({ updatedAt: 1 });
    res.json({ users: users.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// A transparency log — since most accounts are auto-approved, this shows
// what the automation did on its own, alongside anything a human decided.
async function listRecent(req, res, next) {
  try {
    const users = await User.find({ status: { $in: ['accepted', 'rejected'] } })
      .sort({ updatedAt: -1 })
      .limit(25);
    res.json({ users: users.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.status !== 'flagged') {
      return res.status(400).json({ message: `User is not awaiting review (status: ${user.status})` });
    }

    user.status = 'accepted';
    await user.save();
    await sendAccountDecisionEmail(user.email, user.firstName, 'accepted');

    res.json({ message: 'User accepted', user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.status !== 'flagged') {
      return res.status(400).json({ message: `User is not awaiting review (status: ${user.status})` });
    }

    user.status = 'rejected';
    await user.save();
    await sendAccountDecisionEmail(user.email, user.firstName, 'rejected', req.body?.reason);

    res.json({ message: 'User rejected', user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listFlagged, listRecent, approve, reject };
