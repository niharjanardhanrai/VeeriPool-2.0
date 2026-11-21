const mongoose = require('mongoose');

// In-ride chat between the matched rider and driver — the user's own
// request, not from the paper. Only exists in the context of one ride.
const messageSchema = new mongoose.Schema(
  {
    ride: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
