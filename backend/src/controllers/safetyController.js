const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const safety = require('../services/safetyMonitor');
const { isNight, describeWindow } = require('../utils/nightMode');
const { PROFILES } = require('../utils/deviationDetector');

async function loadRidersRide(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: 'Ride not found' });
    return null;
  }
  const ride = await Ride.findById(req.params.id);
  if (!ride) {
    res.status(404).json({ message: 'Ride not found' });
    return null;
  }
  if (String(ride.rider) !== String(req.user._id)) {
    res.status(403).json({ message: 'Only the rider on this ride can do that' });
    return null;
  }
  return ride;
}

// GET /api/safety/mode — whether night rules apply right now.
function getMode(req, res) {
  res.json({ night: isNight(), window: describeWindow(), profiles: PROFILES });
}

// POST /api/rides/:id/safety/respond { answer: 'ok' | 'help' }
async function respond(req, res, next) {
  try {
    const answer = req.body.answer;
    if (!['ok', 'help'].includes(answer)) return res.status(400).json({ message: "answer must be 'ok' or 'help'" });
    const ride = await loadRidersRide(req, res);
    if (!ride) return;
    const alert = await safety.respond(ride, answer);
    if (!alert) return res.status(400).json({ message: 'There is no safety check-in waiting for an answer' });
    res.json({
      message: answer === 'help' ? 'Support has been alerted with your live location. If you are in danger, call 112.' : 'Thanks — glad you are safe.',
      alert: { id: alert._id, type: alert.type, status: alert.status },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:id/safety/sos — the rider asks for help at any time.
async function sos(req, res, next) {
  try {
    const ride = await loadRidersRide(req, res);
    if (!ride) return;
    if (ride.status !== 'accepted') return res.status(400).json({ message: 'SOS is for an active ride — call 112 if you are in danger' });
    await safety.respond(ride, 'help');
    res.json({ message: 'Support has been alerted with your live location. If you are in danger, call 112.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:id/share — a guardian link anyone can open, no login.
async function share(req, res, next) {
  try {
    const ride = await loadRidersRide(req, res);
    if (!ride) return;
    if (!['pending', 'accepted'].includes(ride.status)) return res.status(400).json({ message: `This ride is ${ride.status}` });
    const token = await safety.shareToken(ride);
    res.json({ url: `${req.protocol}://${req.get('host')}/track/${token}`, expiresAt: ride.safety.shareExpiresAt });
  } catch (err) {
    next(err);
  }
}

async function findShared(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const ride = await Ride.findOne({ 'safety.shareToken': token }).populate('rider').populate('driver');
  if (!ride || !ride.safety.shareExpiresAt || ride.safety.shareExpiresAt < new Date()) return null;
  return ride;
}

// GET /api/track/:token — the guardian page polls this.
async function trackJson(req, res, next) {
  try {
    const ride = await findShared(req.params.token);
    if (!ride) return res.status(404).json({ message: 'This tracking link has expired' });
    res.set('Cache-Control', 'no-store');
    res.json({ ride: safety.guardianView(ride) });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMode, respond, sos, share, trackJson };
