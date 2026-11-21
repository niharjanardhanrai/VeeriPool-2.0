// Deviation detector — watches the car's GPS while a rider is on board and
// decides when to ask the rider "Are you safe?". Pure: it takes the previous
// tracker state and one GPS sample and returns the next state, so the same
// code runs live (services/safetyMonitor.js) and in the evaluation
// (src/eval/safetyEval.js).
//
// Three independent signals:
//   off_route  — further than `corridorM` from the planned route for at
//                least `offRouteSec` seconds in a row
//   wrong_way  — driven `wrongWayM` back along the route from the furthest
//                point reached (heading away from the drop-off)
//   long_stop  — parked (within 50 m) for `stopSec`, not at a safe hotspot
//                and not about to arrive
//
// The thresholds tighten at night. After an alert nothing else fires until
// the rider answers or the alert escalates; after "I'm OK" the detector
// re-baselines and stays quiet for QUIET_AFTER_OK_SEC.
const { buildCorridor, locate, distanceM } = require('./routeCorridor');

const PROFILES = {
  day: { corridorM: 250, offRouteSec: 60, wrongWayM: 1000, stopSec: 300, responseSec: 120 },
  night: { corridorM: 150, offRouteSec: 30, wrongWayM: 500, stopSec: 180, responseSec: 60 },
};

const STOP_RADIUS_M = 50;
const NEAR_DESTINATION_M = 1000;
const MAX_ACCURACY_SLACK_M = 50;
const QUIET_AFTER_OK_SEC = 180;
// Without real road geometry the "route" is a straight line, and roads wind
// away from it — so the corridor widens to a quarter of the trip's length.
const STRAIGHT_LINE_CORRIDOR_SHARE = 0.25;

function profileFor({ night, geometry, lengthM }) {
  const base = PROFILES[night ? 'night' : 'day'];
  const corridorM =
    geometry === 'road' ? base.corridorM : Math.max(base.corridorM, Math.round(lengthM * STRAIGHT_LINE_CORRIDOR_SHARE));
  return { ...base, corridorM };
}

function newTracker() {
  return { offSince: null, maxAlongM: null, anchor: null, pending: null, quietUntil: 0 };
}

// sample: { lat, lng, t (ms), accuracy? }
// ctx: { corridor, profile, isSafeStop(point) -> bool }
// Returns { tracker, trigger, escalate, reading }.
function step(prev, sample, ctx) {
  const tracker = { ...prev };
  const { corridor, profile } = ctx;
  const { offRouteM, alongM } = locate(corridor, sample);
  const slack = Math.min(sample.accuracy || 0, MAX_ACCURACY_SLACK_M);
  const effectiveOffM = Math.max(0, offRouteM - slack);
  const reading = { offRouteM: Math.round(offRouteM), alongM: Math.round(alongM), remainingM: Math.round(corridor.lengthM - alongM) };

  // Signals are tracked even while an alert is pending, so the state is
  // right the moment it's answered — they just can't fire a second alert.
  if (effectiveOffM > profile.corridorM) {
    if (tracker.offSince === null) tracker.offSince = sample.t;
  } else {
    tracker.offSince = null;
  }

  if (effectiveOffM <= profile.corridorM) {
    tracker.maxAlongM = tracker.maxAlongM === null ? alongM : Math.max(tracker.maxAlongM, alongM);
  }

  // "Parked" = staying near an anchor point. One wild GPS fix doesn't count
  // as moving off — it takes two in a row outside the radius (widened when
  // the phone reports poor accuracy).
  const stopRadiusM = Math.max(STOP_RADIUS_M, 2 * slack);
  if (!tracker.anchor) {
    tracker.anchor = { lat: sample.lat, lng: sample.lng, t: sample.t, strikes: 0 };
  } else if (distanceM(tracker.anchor, sample) > stopRadiusM) {
    tracker.anchor =
      tracker.anchor.strikes >= 1
        ? { lat: sample.lat, lng: sample.lng, t: sample.t, strikes: 0 }
        : { ...tracker.anchor, strikes: tracker.anchor.strikes + 1 };
  } else if (tracker.anchor.strikes) {
    tracker.anchor = { ...tracker.anchor, strikes: 0 };
  }

  if (tracker.pending) {
    let escalate = false;
    if (!tracker.pending.escalated && sample.t >= tracker.pending.deadline) {
      tracker.pending = { ...tracker.pending, escalated: true };
      escalate = true;
    }
    return { tracker, trigger: null, escalate, reading };
  }
  if (sample.t < tracker.quietUntil) return { tracker, trigger: null, escalate: false, reading };

  let trigger = null;
  if (tracker.offSince !== null && sample.t - tracker.offSince >= profile.offRouteSec * 1000) {
    trigger = { type: 'off_route', detail: `${Math.round(offRouteM)} m off the planned route` };
  } else if (tracker.maxAlongM !== null && tracker.maxAlongM - alongM >= profile.wrongWayM) {
    trigger = { type: 'wrong_way', detail: `${Math.round(tracker.maxAlongM - alongM)} m back the way you came` };
  } else if (
    sample.t - tracker.anchor.t >= profile.stopSec * 1000 &&
    corridor.lengthM - alongM > NEAR_DESTINATION_M &&
    !(ctx.isSafeStop && ctx.isSafeStop(sample))
  ) {
    trigger = { type: 'long_stop', detail: `stopped for ${Math.round((sample.t - tracker.anchor.t) / 60000)} min` };
  }

  if (trigger) {
    tracker.pending = { type: trigger.type, at: sample.t, deadline: sample.t + profile.responseSec * 1000, escalated: false };
  }
  return { tracker, trigger, escalate: false, reading };
}

// Deadline check without a new GPS sample (the phone may have gone quiet).
function checkDeadline(prev, t) {
  if (!prev.pending || prev.pending.escalated || t < prev.pending.deadline) return { tracker: prev, escalate: false };
  return { tracker: { ...prev, pending: { ...prev.pending, escalated: true } }, escalate: true };
}

// The rider answered "I'm OK": clear the alert and start measuring afresh.
function resolve(prev, t) {
  return { ...newTracker(), quietUntil: t + QUIET_AFTER_OK_SEC * 1000 };
}

module.exports = { PROFILES, profileFor, newTracker, step, checkDeadline, resolve, buildCorridor };
