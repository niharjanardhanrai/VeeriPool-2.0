const mongoose = require('mongoose');

// Customer care chat. One thread per rider/driver (`user`); each message is
// from the user, the FAQ bot, or a support agent (an admin account).
const supportMessageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    from: { type: String, enum: ['user', 'bot', 'agent'], required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    readByAgent: { type: Boolean, default: false },
    // Set on bot messages: whether the AI asked for a human / saw an emergency.
    flag: { type: String, enum: ['needs_agent', 'emergency', null], default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
