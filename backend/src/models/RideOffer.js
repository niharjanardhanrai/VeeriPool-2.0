const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    hotspotId: { type: String, required: true },
    label: String,
    area: String,
    lat: Number,
    lng: Number,
  },
  { _id: false }
);

const legSchema = new mongoose.Schema({ km: Number, min: Number }, { _id: false });
const coordSchema = new mongoose.Schema({ lat: Number, lng: Number }, { _id: false });

// A booked seat (or seats) on a posted ride: the rider boards at
// stops[boardIndex] and gets off at stops[alightIndex].
const bookingSchema = new mongoose.Schema({
  rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seats: { type: Number, required: true, min: 1, max: 8 },
  boardIndex: { type: Number, required: true },
  alightIndex: { type: Number, required: true },
  // Fare quoted at booking time — the most this rider will ever pay
  // (see utils/pricing.js "Price cap").
  quotedFare: { type: Number, required: true },
  status: { type: String, enum: ['booked', 'cancelled'], default: 'booked' },
  bookedAt: { type: Date, default: Date.now },
});

// A ride the driver posts ahead of time: "leaving NMAMIT at 5:30 pm for
// Karkala Bus Stand, via these stops, 3 seats". Riders along the way book
// seats between any two stops. Unlike the on-demand Ride (rider requests,
// driver accepts), here the driver publishes the route first.
const rideOfferSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // The route, as an ordered chain of safe hotspots (first = start,
    // last = destination) and the legs between them.
    stops: { type: [stopSchema], validate: (v) => v.length >= 2 },
    legs: [legSchema],
    distanceKm: Number,
    durationMin: Number,
    waypoints: [coordSchema], // road geometry from ORS, or just the stops
    routeChoice: { type: String, enum: ['fastest', 'demand', 'direct', 'custom'], default: 'fastest' },
    routeSource: { type: String, enum: ['ors', 'haversine'], default: 'haversine' },

    // Geohash index (precision 6, ~1.2 × 0.6 km cells). stopCells = the cell
    // of each stop, so "rides with a stop near me" is a multikey index
    // lookup; pathCells = every cell the route crosses.
    stopCells: { type: [String], index: true },
    pathCells: [String],

    departureAt: { type: Date, required: true },
    seatsTotal: { type: Number, required: true, min: 1, max: 8 },
    costPerKm: { type: Number, required: true }, // frozen when posted

    status: {
      type: String,
      enum: ['open', 'started', 'completed', 'cancelled'],
      default: 'open',
    },
    bookings: [bookingSchema],
  },
  // Two riders booking the last seat at once: the second save fails with a
  // VersionError instead of overbooking (see offerController.bookSeat).
  { timestamps: true, optimisticConcurrency: true }
);

rideOfferSchema.index({ status: 1, departureAt: 1 });

rideOfferSchema.methods.activeBookings = function activeBookings() {
  return this.bookings.filter((b) => b.status === 'booked');
};

// Seats taken on each leg — a seat freed when someone gets off can be sold
// again for the rest of the route.
rideOfferSchema.methods.seatsUsedPerLeg = function seatsUsedPerLeg() {
  const used = this.legs.map(() => 0);
  for (const b of this.activeBookings()) {
    for (let i = b.boardIndex; i < b.alightIndex; i++) used[i] += b.seats;
  }
  return used;
};

module.exports = mongoose.model('RideOffer', rideOfferSchema);
