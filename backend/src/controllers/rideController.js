const User = require('../models/User');
const Ride = require('../models/Ride');
const { estimateRoute } = require('../utils/geo');
const { findHotspot, nearestNightSafe } = require('../utils/hotspots');
const { isNight, describeWindow } = require('../utils/nightMode');
const { COST_PER_KM, soloFare } = require('../utils/pricing');
const { toPublicUser } = require('./authController');
const registry = require('../sockets/registry');
const safety = require('../services/safetyMonitor');

// The six stages the car module walks through, in order (Sec. II-B.3.b).
const STAGE_ORDER = [
  'requested',
  'start_journey',
  'head_to_pickup',
  'arrived_pickup',
  'ride_started',
  'ride_ended',
  'finished',
];

// The detector's working state and the share token stay server-side.
function publicSafety(s) {
  if (!s) return null;
  return {
    night: Boolean(s.night),
    geometry: s.geometry,
    routeLine: s.routeLine,
    profile: s.profile,
    monitoring: Boolean(s.tracker),
    lastReading: s.lastReading,
    alerts: (s.alerts || []).map((a) => ({ id: a._id, type: a.type, detail: a.detail, at: a.at, status: a.status })),
    shared: Boolean(s.shareToken),
  };
}

function toPublicRide(ride) {
  const obj = ride.toObject ? ride.toObject() : ride;
  return {
    id: obj._id,
    rider: obj.rider && obj.rider.firstName ? toPublicUser(obj.rider) : obj.rider,
    driver: obj.driver && obj.driver.firstName ? toPublicUser(obj.driver) : obj.driver,
    pickup: obj.pickup,
    dropoff: obj.dropoff,
    seatsRequested: obj.seatsRequested,
    route: obj.route,
    fare: obj.fare,
    status: obj.status,
    stage: obj.stage,
    requestedAt: obj.requestedAt,
    driverLocation: obj.driverLocation,
    safety: publicSafety(obj.safety),
    events: obj.events,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// Sec. II-B.2.a/b/c "Where to" / "From" / "Seats selection": the rider picks
// a dropoff, a pickup, and a seat count, then confirms.
// Sec. II-B.2.d "Request process — Logic behind": the "Confirm-ride" method
// searches the DB for available cars and emits a notification to each of
// them — implemented here as a socket broadcast to every driver with
// enough free seats.
async function requestRide(req, res, next) {
  try {
    const { pickup, dropoff, seatsRequested } = req.body;

    if (!pickup?.lat || !pickup?.lng || !dropoff?.lat || !dropoff?.lng) {
      return res.status(400).json({ message: 'pickup and dropoff coordinates are required' });
    }
    const seats = Number(seatsRequested) || 1;

    // Riders may only be dropped off at a safe hotspot (lit, public, staffed).
    const hotspot = findHotspot(dropoff);
    if (!hotspot) {
      return res.status(400).json({ message: 'Drop-off must be one of the safe hotspots' });
    }
    // At night, only the spots staffed all night count as safe.
    if (isNight() && !hotspot.night) {
      const alternatives = nearestNightSafe(hotspot).map(({ hotspot: h, km }) => ({
        id: h.id,
        label: h.label,
        km: Math.round(km * 100) / 100,
      }));
      return res.status(400).json({
        message: `Night mode (${describeWindow()}): ${hotspot.label} isn't staffed at night. Nearest night-safe drop-off: ${alternatives[0].label} (${alternatives[0].km} km away).`,
        alternatives,
      });
    }

    const route = await estimateRoute(pickup, dropoff);

    const ride = await Ride.create({
      rider: req.user._id,
      pickup,
      dropoff: { lat: hotspot.lat, lng: hotspot.lng, address: hotspot.label },
      seatsRequested: seats,
      route,
      fare: { amount: soloFare(route.distanceKm, seats), costPerKm: COST_PER_KM },
      status: 'pending',
      stage: 'requested',
      requestedAt: new Date(),
    });
    ride.logEvent('requested');
    await ride.save();

    const availableDrivers = await User.find({
      role: 'driver',
      status: 'accepted',
      isAvailable: true,
      'vehicle.seatsTotal': { $gte: seats },
    }).select('_id');

    const payload = toPublicRide(await ride.populate('rider'));
    registry.emitToUsers(
      availableDrivers.map((d) => d._id),
      'ride:new-request',
      payload
    );

    res.status(201).json({
      message: `Ride request sent to ${availableDrivers.length} available car(s).`,
      ride: payload,
    });
  } catch (err) {
    next(err);
  }
}

async function myRides(req, res, next) {
  try {
    const filter = req.user.role === 'driver' ? { driver: req.user._id } : { rider: req.user._id };
    const rides = await Ride.find(filter)
      .sort({ createdAt: -1 })
      .populate('rider')
      .populate('driver');
    res.json({ rides: rides.map(toPublicRide) });
  } catch (err) {
    next(err);
  }
}

// FIFO queue of requests this driver can serve, oldest first — "handling
// multiple requests at the same time in a first come first serve manner"
// (Abstract).
async function getQueue(req, res, next) {
  try {
    const seatsTotal = req.user.vehicle?.seatsTotal || 0;
    const rides = await Ride.find({
      status: 'pending',
      seatsRequested: { $lte: seatsTotal },
    })
      .sort({ requestedAt: 1 })
      .populate('rider');
    res.json({ rides: rides.map(toPublicRide) });
  } catch (err) {
    next(err);
  }
}

async function getRide(req, res, next) {
  try {
    const ride = await Ride.findById(req.params.id).populate('rider').populate('driver');
    if (!ride) return res.status(404).json({ message: 'Ride not found' });

    const isParty =
      String(ride.rider._id) === String(req.user._id) ||
      (ride.driver && String(ride.driver._id) === String(req.user._id)) ||
      req.user.role === 'admin';
    if (!isParty) return res.status(403).json({ message: 'Not authorized to view this ride' });

    res.json({ ride: toPublicRide(ride) });
  } catch (err) {
    next(err);
  }
}

// Sec. II-B.2.d: "he first checks the number of seats that are requested
// and the available ones in the car; if they are compatible, then he
// accepts the ride request". Uses an atomic conditional update so that if
// two drivers race to accept, only the first one wins (409 for the other).
async function acceptRide(req, res, next) {
  try {
    const driver = req.user;
    const rideDoc = await Ride.findById(req.params.id);
    if (!rideDoc) return res.status(404).json({ message: 'Ride not found' });

    if ((driver.vehicle?.seatsTotal || 0) < rideDoc.seatsRequested) {
      return res.status(400).json({ message: 'Not enough seats available in your car for this request' });
    }

    const ride = await Ride.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: 'accepted', stage: 'start_journey', driver: driver._id },
      { new: true }
    )
      .populate('rider')
      .populate('driver');

    if (!ride) {
      return res.status(409).json({ message: 'This ride was already accepted, cancelled, or rejected' });
    }

    ride.logEvent('accepted');
    await ride.save();

    await User.findByIdAndUpdate(driver._id, { isAvailable: false });
    ride.driver.isAvailable = false; // keep the response payload in sync

    const payload = toPublicRide(ride);
    registry.emitToUser(ride.rider._id, 'ride:accepted', payload);

    res.json({ message: 'Ride accepted', ride: payload });
  } catch (err) {
    next(err);
  }
}

// Sec. II-B.2.d: if the requested seats are not compatible, the driver
// rejects; the request stays open for the other cars it was broadcast to.
async function rejectRide(req, res, next) {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'pending') {
      return res.status(400).json({ message: `Ride is already ${ride.status}` });
    }

    ride.logEvent(`rejected_by:${req.user._id}`);
    await ride.save();

    res.json({ message: 'Ride declined' });
  } catch (err) {
    next(err);
  }
}

async function cancelRide(req, res, next) {
  try {
    const ride = await Ride.findOneAndUpdate(
      { _id: req.params.id, rider: req.user._id, status: 'pending' },
      { status: 'cancelled' },
      { new: true }
    ).populate('driver');
    if (!ride) return res.status(400).json({ message: 'Only a pending ride you requested can be cancelled' });

    if (ride.driver) registry.emitToUser(ride.driver._id, 'ride:cancelled', { rideId: ride._id });

    res.json({ message: 'Ride cancelled', ride: toPublicRide(ride) });
  } catch (err) {
    next(err);
  }
}

// Sec. II-B.3.b "Tracking": the driver manually advances the ride through
// start_journey -> head_to_pickup -> arrived_pickup -> ride_started ->
// ride_ended -> finished, each step firing a notification to the rider.
async function updateStage(req, res, next) {
  try {
    const { stage } = req.body;
    const currentIndex = STAGE_ORDER.indexOf(stage);
    if (currentIndex === -1) return res.status(400).json({ message: 'Invalid stage' });

    const ride = await Ride.findById(req.params.id).populate('rider').populate('driver');
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (!ride.driver || String(ride.driver._id) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the assigned driver can update this ride' });
    }
    if (ride.status !== 'accepted') {
      return res.status(400).json({ message: `Ride is ${ride.status}, cannot change stage` });
    }

    const previousIndex = STAGE_ORDER.indexOf(ride.stage);
    if (currentIndex !== previousIndex + 1) {
      return res.status(400).json({
        message: `Stages must advance in order. Current: ${ride.stage}, next expected: ${STAGE_ORDER[previousIndex + 1]}`,
      });
    }

    ride.stage = stage;
    ride.logEvent(stage);

    // The rider is on board from 'Start ride' to 'End ride' — that's when
    // the route is watched for deviations.
    if (stage === 'ride_started') await safety.startMonitoring(ride);
    if (stage === 'ride_ended' || stage === 'finished') safety.stopMonitoring(ride, { finished: stage === 'finished' });

    if (stage === 'finished') {
      ride.status = 'completed';
      await User.findByIdAndUpdate(ride.driver._id, { isAvailable: true });
    }

    await ride.save();

    const payload = toPublicRide(ride);

    if (stage === 'arrived_pickup') {
      registry.emitToUser(ride.rider._id, 'ride:driver-arrived', payload);
    } else if (stage === 'ride_ended') {
      registry.emitToUser(ride.rider._id, 'ride:ended', payload);
    } else {
      registry.emitToUser(ride.rider._id, 'ride:stage', payload);
    }

    res.json({ message: `Stage updated to ${stage}`, ride: payload });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requestRide,
  myRides,
  getQueue,
  getRide,
  acceptRide,
  rejectRide,
  cancelRide,
  updateStage,
  STAGE_ORDER,
};
