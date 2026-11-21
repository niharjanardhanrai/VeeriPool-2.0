// Mirrors backend/src/utils/pricing.js — the fair cost-share rule, used here
// only to preview a fare before the request is sent. The backend computes
// the real fare.
const FUEL_PRICE_PER_LITRE = 103;
const CAR_MILEAGE_KMPL = 15;
const WEAR_PER_KM = 1.5;

export const COST_PER_KM = Math.round((FUEL_PRICE_PER_LITRE / CAR_MILEAGE_KMPL + WEAR_PER_KM) * 100) / 100;

// Trip cost split equally between the driver and each requested seat.
export function soloFare(distanceKm, seats) {
  return Math.round(((distanceKm * COST_PER_KM) / (seats + 1)) * seats);
}

export function formatDeparture(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
