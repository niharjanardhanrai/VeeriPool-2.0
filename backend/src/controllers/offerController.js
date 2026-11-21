const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const RideOffer = require('../models/RideOffer');
const DemandPing = require('../models/DemandPing');
const { haversineKm, roadRouteVia } = require('../utils/geo');
const { getHotspot } = require('../utils/hotspots');
const { encode, searchArea } = require('../utils/geohash');
const { planRoutes, describeStops, demandFromPoints, CELL_PRECISION } = require('../utils/routePlanner');
const { COST_PER_KM, quote, liveFares } = require('../utils/pricing');
const { isNight, describeWindow } = require('../utils/nightMode');
const registry = require('../sockets/registry');

function isNightSafeStop(stop) {
  return Boolean(getHotspot(stop.hotspotId)?.night);
}

// How far a rider will walk to a stop on someone's route. Kept just under
// one precision-6 cell's short side (~0.61 km), so the 3×3 geohash search area is
// guaranteed to contain every stop within this distance.
const MAX_WALK_KM = 0.6;
const MAX_ACTIVE_OFFERS = 3;
const MAX_DAYS_AHEAD = 7;
const DEMAND_WINDOW_MIN = 45;

function publicPerson(user) {
  if (!user || !user.firstName) return user;
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    vehicle: user.vehicle,
  };
}

// The driver sees every booking; a rider sees only their own booking and a
// count of the others.
function toPublicOffer(offer, viewer) {
  const isDriver = String(offer.driver._id || offer.driver) === String(viewer._id);
  const active = offer.activeBookings();
  const pricing = liveFares(offer.legs, active, offer.costPerKm);
  const fareById = new Map(active.map((b, i) => [String(b._id), pricing.fares[i]]));
  const used = offer.seatsUsedPerLeg();

  const bookingView = (b) => ({
    id: b._id,
    rider: publicPerson(b.rider),
    seats: b.seats,
    boardIndex: b.boardIndex,
    alightIndex: b.alightIndex,
    board: offer.stops[b.boardIndex]?.label,
    alight: offer.stops[b.alightIndex]?.label,
    quotedFare: b.quotedFare,
    fare: fareById.get(String(b._id)) ?? null,
    status: b.status,
    bookedAt: b.bookedAt,
  });

  const mine = offer.bookings.find((b) => String(b.rider._id || b.rider) === String(viewer._id) && b.status === 'booked');

  return {
    id: offer._id,
    driver: publicPerson(offer.driver),
    stops: offer.stops,
    legs: offer.legs,
    distanceKm: offer.distanceKm,
    durationMin: offer.durationMin,
    waypoints: offer.waypoints,
    routeChoice: offer.routeChoice,
    routeSource: offer.routeSource,
    departureAt: offer.departureAt,
    nightMode: isNight(offer.departureAt),
    nightSafeStops: offer.stops.map(isNightSafeStop),
    seatsTotal: offer.seatsTotal,
    seatsUsedPerLeg: used,
    seatsFreeFullRoute: offer.seatsTotal - Math.max(0, ...used),
    costPerKm: offer.costPerKm,
    status: offer.status,
    tripCost: Math.round(pricing.tripCost),
    collected: pricing.fares.reduce((s, f) => s + f, 0),
    bookings: isDriver ? offer.bookings.map(bookingView) : undefined,
    bookedCount: active.reduce((s, b) => s + b.seats, 0),
    myBooking: mine ? bookingView(mine) : null,
    isMine: isDriver,
    createdAt: offer.createdAt,
  };
}

async function loadOffer(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return RideOffer.findById(id).populate('driver').populate('bookings.rider');
}

// Where riders are waiting right now: pickups of pending on-demand requests
// plus recent "find a ride" searches, as Map(geohash6 -> count).
async function currentDemand() {
  const since = new Date(Date.now() - DEMAND_WINDOW_MIN * 60 * 1000);
  const [pending, pings] = await Promise.all([
    Ride.find({ status: 'pending', requestedAt: { $gte: since } }).select('pickup'),
    DemandPing.find({ createdAt: { $gte: since } }).select('lat lng'),
  ]);
  return demandFromPoints([...pending.map((r) => r.pickup), ...pings]);
}

// POST /api/offers/plan — route options for the driver to choose from.
async function planOffer(req, res, next) {
  try {
    const { fromId, toId, viaIds = [], seatsTotal } = req.body;
    if (!getHotspot(fromId) || !getHotspot(toId)) {
      return res.status(400).json({ message: 'Start and destination must both be safe hotspots' });
    }
    if (fromId === toId) return res.status(400).json({ message: 'Start and destination must be different' });

    const demand = await currentDemand();
    const seats = Number(seatsTotal) || req.user.vehicle?.seatsTotal || 3;
    const options = planRoutes(fromId, toId, { demand, viaIds: Array.isArray(viaIds) ? viaIds : [] }).map(
      ({ pathCells, ...o }) => {
        const tripCost = o.distanceKm * COST_PER_KM;
        return {
          ...o,
          tripCost: Math.round(tripCost),
          // What one seat end-to-end costs if the car fills up — the
          // per-segment split with every seat taken for the whole route.
          perSeatIfFull: Math.round(tripCost / (seats + 1)),
        };
      }
    );

    res.json({ options, costPerKm: COST_PER_KM, waitingRiders: [...demand.values()].reduce((s, n) => s + n, 0) });
  } catch (err) {
    next(err);
  }
}

// POST /api/offers — the driver publishes a ride along the chosen route.
async function createOffer(req, res, next) {
  try {
    const { stopIds, routeChoice = 'fastest', seatsTotal, departureAt } = req.body;

    let route;
    try {
      route = describeStops(stopIds, routeChoice);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const carSeats = req.user.vehicle?.seatsTotal || 0;
    const seats = Number(seatsTotal);
    if (!seats || seats < 1 || seats > carSeats) {
      return res.status(400).json({ message: `Offer between 1 and ${carSeats} seats` });
    }

    const departure = new Date(departureAt);
    const now = Date.now();
    if (Number.isNaN(departure.getTime()) || departure.getTime() < now - 5 * 60 * 1000) {
      return res.status(400).json({ message: 'Departure time must be now or later' });
    }
    if (departure.getTime() > now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ message: `You can post rides up to ${MAX_DAYS_AHEAD} days ahead` });
    }

    const active = await RideOffer.countDocuments({ driver: req.user._id, status: { $in: ['open', 'started'] } });
    if (active >= MAX_ACTIVE_OFFERS) {
      return res.status(400).json({ message: `You already have ${active} upcoming rides — finish or cancel one first` });
    }

    // Upgrade the straight-line legs to real road distances when ORS is on.
    const road = await roadRouteVia(route.stops);
    const legs = road ? road.legs : route.legs;

    const offer = await RideOffer.create({
      driver: req.user._id,
      stops: route.stops,
      legs,
      distanceKm: road ? road.distanceKm : route.distanceKm,
      durationMin: road ? road.durationMin : route.durationMin,
      waypoints: road ? road.waypoints : route.stops.map(({ lat, lng }) => ({ lat, lng })),
      routeChoice: ['fastest', 'demand', 'direct', 'custom'].includes(routeChoice) ? routeChoice : 'custom',
      routeSource: road ? 'ors' : 'haversine',
      stopCells: route.stops.map((s) => encode(s.lat, s.lng, CELL_PRECISION)),
      pathCells: route.pathCells,
      departureAt: departure,
      seatsTotal: seats,
      costPerKm: COST_PER_KM,
    });

    await offer.populate('driver');
    res.status(201).json({ message: 'Ride posted', offer: toPublicOffer(offer, req.user) });
  } catch (err) {
    next(err);
  }
}

// GET /api/offers/search?lat=&lng=&toId=&seats=
// 1. Geohash pre-filter: rides with a stop in the rider's 3×3 cell area
//    (indexed `stopCells` lookup — no full scan).
// 2. Exact check: nearest stop within walking distance to board, a later
//    stop within walking distance of the destination, seats free on every
//    leg in between.
// 3. Fair-price quote for each match.
async function searchOffers(req, res, next) {
  try {
    const pickup = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
    const dest = getHotspot(req.query.toId);
    const seats = Math.max(1, Math.min(8, Number(req.query.seats) || 1));
    if (Number.isNaN(pickup.lat) || Number.isNaN(pickup.lng)) {
      return res.status(400).json({ message: 'Pickup location is required' });
    }
    if (!dest) return res.status(400).json({ message: 'Destination must be a safe hotspot' });

    const pickupCell = encode(pickup.lat, pickup.lng, CELL_PRECISION);
    await DemandPing.findOneAndUpdate(
      { rider: req.user._id, cell: pickupCell },
      { lat: pickup.lat, lng: pickup.lng, createdAt: new Date() },
      { upsert: true }
    );

    const now = Date.now();
    const candidates = await RideOffer.find({
      status: 'open',
      driver: { $ne: req.user._id },
      departureAt: { $gte: new Date(now - 15 * 60 * 1000) },
      stopCells: { $in: searchArea(pickup, CELL_PRECISION) },
    })
      .sort({ departureAt: 1 })
      .limit(50)
      .populate('driver')
      .populate('bookings.rider');

    const matches = [];
    for (const offer of candidates) {
      const stops = offer.stops;
      let boardIndex = -1;
      let walkToBoard = Infinity;
      stops.slice(0, -1).forEach((s, i) => {
        const km = haversineKm(s, pickup);
        if (km < walkToBoard) {
          walkToBoard = km;
          boardIndex = i;
        }
      });
      if (boardIndex === -1 || walkToBoard > MAX_WALK_KM) continue;

      // A ride leaving at night only lets riders off at night-safe stops.
      const night = isNight(offer.departureAt);
      let alightIndex = -1;
      let walkFromAlight = Infinity;
      for (let j = boardIndex + 1; j < stops.length; j++) {
        if (night && !isNightSafeStop(stops[j])) continue;
        const km = haversineKm(stops[j], dest);
        if (km < walkFromAlight) {
          walkFromAlight = km;
          alightIndex = j;
        }
      }
      if (alightIndex === -1 || walkFromAlight > MAX_WALK_KM) continue;

      const used = offer.seatsUsedPerLeg();
      const freeSeats = offer.seatsTotal - Math.max(...used.slice(boardIndex, alightIndex));
      if (freeSeats < seats) continue;

      const active = offer.activeBookings();
      const candidate = { seats, boardIndex, alightIndex };
      const rideKm = offer.legs.slice(boardIndex, alightIndex).reduce((s, l) => s + l.km, 0);

      matches.push({
        offer: toPublicOffer(offer, req.user),
        boardIndex,
        alightIndex,
        board: stops[boardIndex].label,
        alight: stops[alightIndex].label,
        walkToBoardKm: Math.round(walkToBoard * 100) / 100,
        walkFromAlightKm: Math.round(walkFromAlight * 100) / 100,
        rideKm: Math.round(rideKm * 100) / 100,
        nightMode: night,
        freeSeats,
        fare: quote(offer.legs, active, candidate, offer.costPerKm),
        // The same distance alone in a car (you + driver) — what the split
        // saves you.
        aloneFare: Math.round(((rideKm * offer.costPerKm) / (seats + 1)) * seats),
        alreadyBooked: Boolean(offer.bookings.find((b) => String(b.rider._id) === String(req.user._id) && b.status === 'booked')),
      });
    }

    matches.sort((a, b) => new Date(a.offer.departureAt) - new Date(b.offer.departureAt) || a.walkToBoardKm - b.walkToBoardKm);
    res.json({ matches, pickupCell });
  } catch (err) {
    next(err);
  }
}

// GET /api/offers/mine — the driver's posted rides, or the rider's bookings.
async function myOffers(req, res, next) {
  try {
    const filter =
      req.user.role === 'driver' ? { driver: req.user._id } : { 'bookings.rider': req.user._id };
    const offers = await RideOffer.find(filter)
      .sort({ departureAt: -1 })
      .limit(30)
      .populate('driver')
      .populate('bookings.rider');
    res.json({ offers: offers.map((o) => toPublicOffer(o, req.user)) });
  } catch (err) {
    next(err);
  }
}

async function getOffer(req, res, next) {
  try {
    const offer = await loadOffer(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Ride not found' });
    res.json({ offer: toPublicOffer(offer, req.user) });
  } catch (err) {
    next(err);
  }
}

// POST /api/offers/:id/book { boardIndex, alightIndex, seats }
async function bookSeat(req, res, next) {
  try {
    const offer = await loadOffer(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Ride not found' });
    if (offer.status !== 'open') return res.status(400).json({ message: `This ride is ${offer.status}` });
    if (String(offer.driver._id) === String(req.user._id)) {
      return res.status(400).json({ message: "You can't book your own ride" });
    }

    const boardIndex = Number(req.body.boardIndex);
    const alightIndex = Number(req.body.alightIndex);
    const seats = Number(req.body.seats) || 1;
    if (
      !Number.isInteger(boardIndex) ||
      !Number.isInteger(alightIndex) ||
      boardIndex < 0 ||
      alightIndex >= offer.stops.length ||
      boardIndex >= alightIndex
    ) {
      return res.status(400).json({ message: 'Choose a boarding stop before your drop-off stop' });
    }
    if (isNight(offer.departureAt) && !isNightSafeStop(offer.stops[alightIndex])) {
      return res.status(400).json({
        message: `This ride leaves during night hours (${describeWindow()}) — choose a drop-off stop that's staffed all night (🌙).`,
      });
    }
    if (offer.bookings.some((b) => String(b.rider._id) === String(req.user._id) && b.status === 'booked')) {
      return res.status(400).json({ message: 'You already have a seat on this ride' });
    }

    const used = offer.seatsUsedPerLeg();
    const free = offer.seatsTotal - Math.max(...used.slice(boardIndex, alightIndex));
    if (free < seats) return res.status(409).json({ message: `Only ${free} seat(s) left on that part of the route` });

    const candidate = { seats, boardIndex, alightIndex };
    const quotedFare = quote(offer.legs, offer.activeBookings(), candidate, offer.costPerKm);
    offer.bookings.push({ rider: req.user._id, ...candidate, quotedFare });

    try {
      await offer.save();
    } catch (err) {
      if (err.name === 'VersionError') {
        return res.status(409).json({ message: 'Someone booked at the same moment — please try again' });
      }
      throw err;
    }

    const fresh = await loadOffer(offer._id);
    registry.emitToUser(fresh.driver._id, 'offer:booked', toPublicOffer(fresh, fresh.driver));
    res.status(201).json({ message: `Seat booked — ₹${quotedFare} at most`, offer: toPublicOffer(fresh, req.user) });
  } catch (err) {
    next(err);
  }
}

// POST /api/offers/:id/cancel-booking — rider drops out before departure.
async function cancelBooking(req, res, next) {
  try {
    const offer = await loadOffer(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Ride not found' });
    const booking = offer.bookings.find((b) => String(b.rider._id) === String(req.user._id) && b.status === 'booked');
    if (!booking) return res.status(400).json({ message: "You don't have a seat on this ride" });
    if (offer.status !== 'open') return res.status(400).json({ message: 'The ride has already started' });

    booking.status = 'cancelled';
    await offer.save();
    registry.emitToUser(offer.driver._id, 'offer:booked', toPublicOffer(offer, offer.driver));
    res.json({ message: 'Booking cancelled', offer: toPublicOffer(offer, req.user) });
  } catch (err) {
    next(err);
  }
}

const TRANSITIONS = { open: ['started', 'cancelled'], started: ['completed'] };

// POST /api/offers/:id/status { status } — driver starts, finishes or
// cancels the ride; every booked rider is notified.
async function updateOfferStatus(req, res, next) {
  try {
    const offer = await loadOffer(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Ride not found' });
    if (String(offer.driver._id) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the driver can update this ride' });
    }
    const { status } = req.body;
    if (!(TRANSITIONS[offer.status] || []).includes(status)) {
      return res.status(400).json({ message: `Can't go from ${offer.status} to ${status}` });
    }

    offer.status = status;
    await offer.save();

    for (const b of offer.activeBookings()) {
      registry.emitToUser(b.rider._id, 'offer:status', toPublicOffer(offer, b.rider));
    }
    res.json({ message: `Ride ${status}`, offer: toPublicOffer(offer, req.user) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  planOffer,
  createOffer,
  searchOffers,
  myOffers,
  getOffer,
  bookSeat,
  cancelBooking,
  updateOfferStatus,
};
