const mongoose = require('mongoose');

// "Someone wanted a ride from here" — logged when a rider searches posted
// rides, keyed by the precision-6 geohash of their pickup. Drivers planning
// a route see these (plus pending on-demand requests) as the demand that
// the "Most riders on the way" route option bends towards. MongoDB's TTL
// index deletes each ping after 45 minutes, so only fresh demand counts.
const demandPingSchema = new mongoose.Schema({
  cell: { type: String, required: true, index: true },
  lat: Number,
  lng: Number,
  rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now, expires: 45 * 60 },
});

module.exports = mongoose.model('DemandPing', demandPingSchema);
