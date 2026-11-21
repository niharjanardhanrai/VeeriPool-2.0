const Ride = require('../models/Ride');
const Message = require('../models/Message');
const registry = require('../sockets/registry');

async function assertParty(ride, userId) {
  const isParty = String(ride.rider) === String(userId) || (ride.driver && String(ride.driver) === String(userId));
  return isParty;
}

function toPublicMessage(msg) {
  return {
    id: msg._id,
    ride: msg.ride,
    sender: msg.sender,
    text: msg.text,
    createdAt: msg.createdAt,
  };
}

async function listMessages(req, res, next) {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (!(await assertParty(ride, req.user._id)) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this conversation' });
    }
    const messages = await Message.find({ ride: ride._id }).sort({ createdAt: 1 });
    res.json({ messages: messages.map(toPublicMessage) });
  } catch (err) {
    next(err);
  }
}

// Chat only makes sense once a driver is matched, and stays open through
// completion so either side can follow up (e.g. "left my bag in the car").
async function sendMessage(req, res, next) {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Message text is required' });

    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (!(await assertParty(ride, req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to message on this ride' });
    }
    if (!ride.driver) {
      return res.status(400).json({ message: 'Chat opens once a driver accepts this ride' });
    }

    const message = await Message.create({ ride: ride._id, sender: req.user._id, text: text.trim() });
    const payload = toPublicMessage(message);

    const otherPartyId = String(ride.rider) === String(req.user._id) ? ride.driver : ride.rider;
    registry.emitToUser(otherPartyId, 'ride:message', payload);

    res.status(201).json({ message: payload });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMessages, sendMessage };
