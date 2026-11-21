const mongoose = require('mongoose');
const User = require('../models/User');
const SupportMessage = require('../models/SupportMessage');
const Ride = require('../models/Ride');
const registry = require('../sockets/registry');
const { FALLBACK } = require('../services/supportBot');
const { generateReply, isEnabled: aiEnabled } = require('../services/supportAI');

// Customer care chat. Riders/drivers each have one thread with support:
// the AI assistant (services/supportAI.js) answers instantly and flags
// threads that need a person; any admin can read every thread and reply as
// a support agent. New messages are pushed live over the support:message
// socket event to the user and to every admin.
const HUMAN_TAKEOVER_MS = 15 * 60 * 1000;

function toPublicMessage(msg) {
  return {
    id: msg._id,
    user: msg.user,
    from: msg.from,
    agentName: msg.agent?.firstName || null,
    flag: msg.flag || null,
    text: msg.text,
    createdAt: msg.createdAt,
  };
}

async function emitToAdmins(event, payload) {
  const admins = await User.find({ role: 'admin' }).select('_id');
  registry.emitToUsers(admins.map((a) => a._id), event, payload);
}

async function getMyMessages(req, res, next) {
  try {
    const messages = await SupportMessage.find({ user: req.user._id }).sort({ createdAt: 1 }).populate('agent', 'firstName');
    res.json({ messages: messages.map(toPublicMessage), ai: aiEnabled() });
  } catch (err) {
    next(err);
  }
}

async function sendMyMessage(req, res, next) {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ message: 'Message text is required' });
    if (text.length > 1000) return res.status(400).json({ message: 'Message is too long (max 1000 characters)' });

    const userMsg = await SupportMessage.create({ user: req.user._id, from: 'user', text });
    const created = [userMsg];

    // If a human agent replied recently, they're handling it — the AI stays
    // quiet so it doesn't talk over them.
    const lastAgent = await SupportMessage.findOne({ user: req.user._id, from: 'agent' }).sort({ createdAt: -1 });
    const humanActive = lastAgent && Date.now() - lastAgent.createdAt.getTime() < HUMAN_TAKEOVER_MS;

    if (!humanActive) {
      const [thread, latestRide] = await Promise.all([
        SupportMessage.find({ user: req.user._id }).sort({ createdAt: 1 }).populate('agent', 'firstName'),
        Ride.findOne({ $or: [{ rider: req.user._id }, { driver: req.user._id }] }).sort({ requestedAt: -1 }),
      ]);
      const reply = await generateReply({ user: req.user, thread, latestRide });

      // The FAQ fallback doesn't repeat its generic "an agent will reply"
      // line if it already said so and no agent has replied since.
      const last = [...thread].reverse().find((m) => m.from !== 'user');
      const repeatFallback = reply.text === FALLBACK && last?.from === 'bot' && last.text === FALLBACK;
      if (!repeatFallback) {
        const flag = reply.emergency ? 'emergency' : reply.needsHuman ? 'needs_agent' : null;
        created.push(
          await SupportMessage.create({ user: req.user._id, from: 'bot', text: reply.text, flag, readByAgent: true })
        );
      }
    }

    const payloads = created.map(toPublicMessage);
    const userSummary = { id: req.user._id, firstName: req.user.firstName, lastName: req.user.lastName, role: req.user.role };
    for (const p of payloads) {
      await emitToAdmins('support:message', { ...p, userSummary });
    }
    res.status(201).json({ messages: payloads });
  } catch (err) {
    next(err);
  }
}

// Admin: one row per user who has contacted support, newest activity first.
async function listThreads(req, res, next) {
  try {
    const rows = await SupportMessage.aggregate([
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$user',
          lastText: { $last: '$text' },
          lastFrom: { $last: '$from' },
          lastAt: { $last: '$createdAt' },
          unread: { $sum: { $cond: [{ $and: [{ $eq: ['$from', 'user'] }, { $eq: ['$readByAgent', false] }] }, 1, 0] } },
          lastAgentAt: { $max: { $cond: [{ $eq: ['$from', 'agent'] }, '$createdAt', null] } },
          lastNeedsAgentAt: { $max: { $cond: [{ $ne: ['$flag', null] }, '$createdAt', null] } },
          lastEmergencyAt: { $max: { $cond: [{ $eq: ['$flag', 'emergency'] }, '$createdAt', null] } },
        },
      },
      { $sort: { lastAt: -1 } },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('firstName lastName role username');
    const byId = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      threads: rows
        .filter((r) => byId.has(String(r._id)))
        .map((r) => {
          const u = byId.get(String(r._id));
          return {
            userId: r._id,
            name: `${u.firstName} ${u.lastName}`,
            username: u.username,
            role: u.role,
            lastText: r.lastText,
            lastFrom: r.lastFrom,
            lastAt: r.lastAt,
            unread: r.unread,
            // Flags stay up until a human agent replies after them.
            emergency: Boolean(r.lastEmergencyAt && (!r.lastAgentAt || r.lastEmergencyAt > r.lastAgentAt)),
            needsAgent: Boolean(r.lastNeedsAgentAt && (!r.lastAgentAt || r.lastNeedsAgentAt > r.lastAgentAt)),
          };
        }),
    });
  } catch (err) {
    next(err);
  }
}

async function getThread(req, res, next) {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ message: 'Invalid user id' });
    const user = await User.findById(userId).select('firstName lastName role username');
    if (!user) return res.status(404).json({ message: 'User not found' });

    await SupportMessage.updateMany({ user: userId, from: 'user', readByAgent: false }, { readByAgent: true });
    const messages = await SupportMessage.find({ user: userId }).sort({ createdAt: 1 }).populate('agent', 'firstName');
    res.json({
      user: { id: user._id, name: `${user.firstName} ${user.lastName}`, role: user.role, username: user.username },
      messages: messages.map(toPublicMessage),
    });
  } catch (err) {
    next(err);
  }
}

async function replyToThread(req, res, next) {
  try {
    const { userId } = req.params;
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ message: 'Message text is required' });
    if (!mongoose.isValidObjectId(userId) || !(await User.exists({ _id: userId }))) {
      return res.status(404).json({ message: 'User not found' });
    }

    const msg = await SupportMessage.create({ user: userId, from: 'agent', agent: req.user._id, text, readByAgent: true });
    await msg.populate('agent', 'firstName');
    const payload = toPublicMessage(msg);

    registry.emitToUser(userId, 'support:message', payload);
    await emitToAdmins('support:message', payload);
    res.status(201).json({ message: payload });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyMessages, sendMyMessage, listThreads, getThread, replyToThread, toPublicMessage, emitToAdmins };
