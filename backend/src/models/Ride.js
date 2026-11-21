const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String, trim: true },
  },
  { _id: false }
);

const coordSchema = new mongoose.Schema({ lat: Number, lng: Number }, { _id: false });

// Mirrors the GO-DRiVeS ride lifecycle (Sec. II-B.2/3):
//   status: pending -> accepted -> completed   (or rejected / cancelled)
//   stage (only meaningful once accepted): the six stages the car module
//   walks through — "Start Journey, Head to Pickup, I Have Arrived, Start
//   Ride, End Ride and Finish".
const rideSchema = new mongoose.Schema(
  {
    rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    pickup: { type: pointSchema, required: true },
    dropoff: { type: pointSchema, required: true },
    seatsRequested: { type: Number, required: true, min: 1, max: 8 },

    // Estimated at request time by the routing service — real ORS routing
    // when ORS_API_KEY is configured, a haversine straight line otherwise
    // (see src/utils/geo.js). `waypoints` is the polyline to draw: the real
    // road geometry from ORS, or just [pickup, dropoff] as a fallback.
    route: {
      distanceKm: Number,
      durationMin: Number,
      waypoints: [coordSchema],
      source: { type: String, enum: ['ors', 'haversine'] },
    },

    // Fair cost-share for the trip (utils/pricing.js soloFare): the trip's
    // fuel + wear cost split between the driver and the requested seats.
    fare: {
      amount: Number,
      costPerKm: Number,
    },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'completed', 'cancelled'],
      default: 'pending',
    },
    stage: {
      type: String,
      enum: ['requested', 'start_journey', 'head_to_pickup', 'arrived_pickup', 'ride_started', 'ride_ended', 'finished'],
      default: 'requested',
    },

    // FIFO ordering — GO-DRiVeS "handles multiple requests at the same
    // time in a first come first serve manner" (Abstract).
    requestedAt: { type: Date, default: Date.now },

    // Last known live position of the car while this ride is active,
    // updated over the ride:location socket event.
    driverLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date,
    },

    // Route-deviation monitoring while the rider is on board (from "Start
    // ride" to "End ride") — see services/safetyMonitor.js. `night` and
    // `profile` are frozen when the ride starts; `tracker` is the detector's
    // working state; `alerts` is the history shown to the rider, the
    // guardian link and support.
    safety: {
      night: Boolean,
      geometry: { type: String, enum: ['road', 'straight'] },
      routeLine: [coordSchema], // the corridor's centre line
      profile: {
        corridorM: Number,
        offRouteSec: Number,
        wrongWayM: Number,
        stopSec: Number,
        responseSec: Number,
      },
      tracker: { type: mongoose.Schema.Types.Mixed, default: null },
      lastReading: { offRouteM: Number, alongM: Number, remainingM: Number, at: Date },
      alerts: [
        {
          type: { type: String, enum: ['off_route', 'wrong_way', 'long_stop', 'sos'] },
          detail: String,
          at: Date,
          lat: Number,
          lng: Number,
          status: { type: String, enum: ['awaiting', 'ok', 'escalated'], default: 'awaiting' },
          resolvedAt: Date,
          escalatedBecause: { type: String, enum: ['no_response', 'rider_asked', null], default: null },
        },
      ],
      // Guardian live-tracking link: /track/<shareToken>, no login needed.
      shareToken: { type: String, index: true, sparse: true },
      shareExpiresAt: Date,
    },

    events: [
      {
        type: { type: String },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

rideSchema.methods.logEvent = function logEvent(type) {
  this.events.push({ type, at: new Date() });
};

module.exports = mongoose.model('Ride', rideSchema);
