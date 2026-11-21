// Mirrors backend/src/controllers/rideController.js STAGE_ORDER — the six
// stages from Sec. II-B.3.b: "Start Journey, Head to Pickup, I Have Arrived,
// Start Ride, End Ride and Finish".
export const STAGE_ORDER = [
  'requested',
  'start_journey',
  'head_to_pickup',
  'arrived_pickup',
  'ride_started',
  'ride_ended',
  'finished',
];

export const STAGE_LABELS = {
  requested: 'Waiting for a driver',
  start_journey: 'Driver accepted — starting journey',
  head_to_pickup: 'Driver heading to your pickup point',
  arrived_pickup: 'Driver has arrived at pickup',
  ride_started: 'On the way to your drop-off',
  ride_ended: 'Arrived at drop-off',
  finished: 'Ride complete',
};

// What the driver taps next, from their current stage.
export const NEXT_STAGE = {
  start_journey: { stage: 'head_to_pickup', label: 'Head to pickup' },
  head_to_pickup: { stage: 'arrived_pickup', label: "I've arrived" },
  arrived_pickup: { stage: 'ride_started', label: 'Start ride' },
  ride_started: { stage: 'ride_ended', label: 'End ride' },
  ride_ended: { stage: 'finished', label: 'Finish' },
};
