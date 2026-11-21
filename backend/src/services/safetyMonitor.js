const crypto = require('crypto');
const Ride = require('../models/Ride');
const SupportMessage = require('../models/SupportMessage');
const registry = require('../sockets/registry');
const { haversineKm } = require('../utils/geo');
const { SAFE_HOTSPOTS } = require('../utils/hotspots');
const { isNight } = require('../utils/nightMode');
const detector = require('../utils/deviationDetector');
const { getDirections } = require('../utils/directions');

// Live route-deviation monitoring. While the rider is on board ("Start
// ride" -> "End ride"), every GPS tick from the driver goes through the
// deviation detector (utils/deviationDetector.js). When it fires:
//   1. the rider gets "Are you safe?" with a countdown (ride:safety-alert),
//      and the driver a neutral "you've left the planned route" notice;
//   2. "I'm OK" clears it; "Get help", or no answer before the deadline,
//      escalates — an 🚨 Emergency message lands in the rider's support
//      thread with the driver's details and last location, pushed live to
//      every admin, and the guardian link shows the alert.
// The driver is never told about an escalation.
const SAFE_STOP_RADIUS_KM = 0.15;
const SHARE_TTL_MS = 12 * 60 * 60 * 1000;
const SHARE_AFTER_FINISH_MS = 30 * 60 * 1000;

const corridors = new Map(); // rideId -> prepared corridor (rebuilt after a restart)
const timers = new Map(); // rideId -> deadline timeout

// The line the corridor is drawn around: the road geometry fetched when
// the ride started, else the ride's own route, else a straight line.
function routePoints(ride) {
  if (ride.safety?.routeLine?.length >= 2) return ride.safety.routeLine.map(({ lat, lng }) => ({ lat, lng }));
  const wp = ride.route?.waypoints || [];
  return wp.length >= 2 ? wp.map(({ lat, lng }) => ({ lat, lng })) : [ride.pickup, ride.dropoff];
}

function corridorFor(ride) {
  const key = String(ride._id);
  if (!corridors.has(key)) corridors.set(key, detector.buildCorridor(routePoints(ride)));
  return corridors.get(key);
}

function isSafeStop(point) {
  return SAFE_HOTSPOTS.some((h) => haversineKm(h, point) <= SAFE_STOP_RADIUS_KM);
}

function plainProfile(ride) {
  const p = ride.safety.profile;
  return p.toObject ? p.toObject() : p;
}

function clearTimer(rideId) {
  clearTimeout(timers.get(String(rideId)));
  timers.delete(String(rideId));
}

function scheduleDeadline(ride, deadline) {
  const rideId = String(ride._id);
  clearTimer(rideId);
  timers.set(
    rideId,
    setTimeout(() => deadlinePassed(rideId).catch((err) => console.error('safety deadline error', err.message)), Math.max(0, deadline - Date.now()) + 250)
  );
}

// Called by the stage handler as the ride moves to "Start ride". Uses
// real road geometry — ORS if the ride already has it, else the free OSRM
// server (utils/directions.js) — so the corridor follows the actual roads;
// only if both are unreachable does it fall back to a wide straight-line one.
async function startMonitoring(ride) {
  let routeLine = (ride.route?.waypoints || []).map(({ lat, lng }) => ({ lat, lng }));
  let geometry = ride.route?.source === 'ors' && routeLine.length > 2 ? 'road' : 'straight';
  if (geometry !== 'road') {
    const directions = await getDirections([ride.pickup, ride.dropoff]);
    if (directions.source === 'osrm' && directions.geometry.length >= 2) {
      routeLine = directions.geometry;
      geometry = 'road';
    } else {
      routeLine = [ride.pickup, ride.dropoff].map(({ lat, lng }) => ({ lat, lng }));
    }
  }
  corridors.delete(String(ride._id));
  const corridor = detector.buildCorridor(routeLine);
  corridors.set(String(ride._id), corridor);
  const night = isNight();
  ride.safety = {
    ...(ride.safety?.toObject ? ride.safety.toObject() : ride.safety || {}),
    night,
    geometry,
    routeLine,
    profile: detector.profileFor({ night, geometry, lengthM: corridor.lengthM }),
    tracker: detector.newTracker(),
  };
}

// "End ride": stop watching. The guardian link lives on briefly after
// "Finish" so whoever was following sees the ride end.
function stopMonitoring(ride, { finished = false } = {}) {
  clearTimer(ride._id);
  corridors.delete(String(ride._id));
  if (!ride.safety) return;
  ride.safety.tracker = null;
  ride.markModified('safety.tracker');
  if (finished && ride.safety.shareToken) ride.safety.shareExpiresAt = new Date(Date.now() + SHARE_AFTER_FINISH_MS);
}

function latestAwaiting(ride) {
  return [...(ride.safety?.alerts || [])].reverse().find((a) => a.status === 'awaiting') || null;
}

// One GPS tick. Mutates `ride` (the caller saves it) and returns the
// side effects to run once it's saved.
function onLocation(ride, sample) {
  if (ride.stage !== 'ride_started' || !ride.safety?.tracker) return [];
  const { tracker, trigger, escalate, reading } = detector.step(ride.safety.tracker, sample, {
    corridor: corridorFor(ride),
    profile: plainProfile(ride),
    isSafeStop,
  });
  ride.safety.tracker = tracker;
  ride.markModified('safety.tracker');
  ride.safety.lastReading = { ...reading, at: new Date(sample.t) };

  const effects = [];
  if (trigger) {
    ride.safety.alerts.push({ type: trigger.type, detail: trigger.detail, at: new Date(sample.t), lat: sample.lat, lng: sample.lng });
    effects.push({ kind: 'alert', alert: ride.safety.alerts[ride.safety.alerts.length - 1], deadline: tracker.pending.deadline });
  }
  if (escalate) effects.push(markEscalated(ride, 'no_response'));
  return effects;
}

function markEscalated(ride, reason, point = ride.driverLocation) {
  let alert = latestAwaiting(ride);
  if (!alert) {
    // An SOS with nothing pending — logged as its own alert.
    ride.safety.alerts.push({ type: 'sos', detail: 'rider pressed SOS', at: new Date(), lat: point?.lat, lng: point?.lng });
    alert = ride.safety.alerts[ride.safety.alerts.length - 1];
  }
  alert.status = 'escalated';
  alert.escalatedBecause = reason;
  alert.resolvedAt = new Date();
  if (ride.safety.tracker) {
    ride.safety.tracker = { ...ride.safety.tracker, pending: { ...(ride.safety.tracker.pending || { type: 'sos', at: Date.now() }), escalated: true } };
    ride.markModified('safety.tracker');
  }
  return { kind: 'escalate', alert, reason };
}

const ALERT_TEXT = {
  off_route: 'Your car has left the planned route',
  wrong_way: 'Your car is heading away from your drop-off',
  long_stop: 'Your car has been stopped for a while away from any safe spot',
  sos: 'SOS',
};

function mapLink(p) {
  if (!p?.lat) return 'unknown';
  const lat = p.lat.toFixed(5);
  const lng = p.lng.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

async function runEffects(ride, effects) {
  if (!effects.length) return;
  await ride.populate([{ path: 'rider' }, { path: 'driver' }]);
  const riderId = ride.rider._id || ride.rider;
  const driverId = ride.driver?._id || ride.driver;

  for (const effect of effects) {
    if (effect.kind === 'alert') {
      const { alert, deadline } = effect;
      registry.emitToUser(riderId, 'ride:safety-alert', {
        rideId: ride._id,
        alert: { id: alert._id, type: alert.type, detail: alert.detail, at: alert.at },
        message: `${ALERT_TEXT[alert.type]} (${alert.detail}). Are you safe?`,
        deadline,
        night: ride.safety.night,
      });
      registry.emitToUser(driverId, 'ride:safety-notice', {
        rideId: ride._id,
        message: 'You seem to have left the planned route — the rider has been asked to check in.',
      });
      scheduleDeadline(ride, deadline);
    }

    if (effect.kind === 'escalate') {
      clearTimer(ride._id);
      // Lazy require: supportController -> supportAI is a heavy import, and
      // controllers already depend on this module.
      const { toPublicMessage, emitToAdmins } = require('../controllers/supportController');
      const { alert, reason } = effect;
      const r = ride.rider;
      const d = ride.driver;
      const why = reason === 'rider_asked' ? 'The rider asked for help.' : "The rider didn't answer the safety check-in.";
      const text = [
        `🚨 Automatic safety alert — ${r.firstName} ${r.lastName}'s ride ${ride.pickup.address || 'pickup'} → ${ride.dropoff.address}.`,
        `${ALERT_TEXT[alert.type]}${alert.type === 'sos' ? '' : ` (${alert.detail})`}. ${why}`,
        d ? `Driver: ${d.firstName} ${d.lastName}, ${d.phone || 'no phone'}, ${d.vehicle?.make || 'car'} ${d.vehicle?.plate || ''}.` : '',
        `Last location: ${mapLink(ride.driverLocation)}`,
        'If anyone is in danger, call 112 now.',
      ]
        .filter(Boolean)
        .join('\n');
      const msg = await SupportMessage.create({ user: riderId, from: 'bot', text: text.slice(0, 1000), flag: 'emergency', readByAgent: false });
      const payload = toPublicMessage(msg);
      registry.emitToUser(riderId, 'support:message', payload);
      await emitToAdmins('support:message', {
        ...payload,
        userSummary: { id: riderId, firstName: r.firstName, lastName: r.lastName, role: r.role },
      });
      registry.emitToUser(riderId, 'ride:safety-escalated', {
        rideId: ride._id,
        alert: { id: alert._id, type: alert.type, status: alert.status },
        message: 'Support has been alerted with your live location. If you are in danger, call 112.',
      });
    }
  }
}

async function deadlinePassed(rideId) {
  timers.delete(rideId);
  const ride = await Ride.findById(rideId);
  if (!ride || ride.stage !== 'ride_started' || !ride.safety?.tracker) return;
  const { tracker, escalate } = detector.checkDeadline(ride.safety.tracker, Date.now());
  if (!escalate) return;
  ride.safety.tracker = tracker;
  const effect = markEscalated(ride, 'no_response');
  await ride.save();
  await runEffects(ride, [effect]);
}

// The rider's answer to a check-in: 'ok' or 'help'.
async function respond(ride, answer) {
  if (answer === 'help') {
    const effect = markEscalated(ride, 'rider_asked');
    await ride.save();
    await runEffects(ride, [effect]);
    return effect.alert;
  }
  const alert = latestAwaiting(ride);
  if (!alert) return null;
  alert.status = 'ok';
  alert.resolvedAt = new Date();
  if (ride.safety.tracker) {
    ride.safety.tracker = detector.resolve(ride.safety.tracker, Date.now());
    ride.markModified('safety.tracker');
  }
  clearTimer(ride._id);
  await ride.save();
  return alert;
}

async function shareToken(ride) {
  if (!ride.safety?.shareToken) {
    ride.safety = ride.safety || {};
    ride.safety.shareToken = crypto.randomBytes(18).toString('base64url');
  }
  ride.safety.shareExpiresAt = new Date(Date.now() + SHARE_TTL_MS);
  await ride.save();
  return ride.safety.shareToken;
}

// What someone following the guardian link may see: first names, the car,
// the route and live position, the stage and the alert history.
function guardianView(ride) {
  return {
    rider: ride.rider?.firstName,
    driver: ride.driver ? { firstName: ride.driver.firstName, vehicle: ride.driver.vehicle } : null,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    waypoints: routePoints(ride),
    stage: ride.stage,
    status: ride.status,
    driverLocation: ride.driverLocation,
    night: Boolean(ride.safety?.night),
    corridorM: ride.safety?.profile?.corridorM || null,
    lastReading: ride.safety?.lastReading,
    alerts: (ride.safety?.alerts || []).map((a) => ({ type: a.type, detail: a.detail, at: a.at, status: a.status })),
    updatedAt: ride.updatedAt,
  };
}

module.exports = { startMonitoring, stopMonitoring, onLocation, runEffects, respond, markEscalated, shareToken, guardianView };
