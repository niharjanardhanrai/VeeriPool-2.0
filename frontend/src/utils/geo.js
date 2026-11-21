// Mirrors backend/src/utils/geo.js — a haversine-distance stand-in for the
// paper's ORS-based routing (Sec. II-A "Routing"), used here to preview the
// trip distance/time before the rider confirms a request.
const EARTH_RADIUS_KM = 6371;
const ASSUMED_AVERAGE_SPEED_KMH = 22;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export function estimateRoute(origin, destination) {
  const distanceKm = Math.round(haversineKm(origin, destination) * 100) / 100;
  const durationMin = Math.max(1, Math.round((distanceKm / ASSUMED_AVERAGE_SPEED_KMH) * 60));
  return { distanceKm, durationMin };
}

// Linear interpolation between two points — used to animate a simulated GPS
// ping from the driver's current spot towards the pickup/dropoff, standing
// in for Expo Location's real device GPS (Sec. II-A "Tracking").
export function lerp(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

// The point a fraction t (0–1) of the way along a polyline, by distance —
// used to move the simulated car along the road instead of a straight line.
export function pointAlong(line, t) {
  if (!line || line.length < 2) return line?.[0] || null;
  const seg = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot(line[i].lat - line[i - 1].lat, line[i].lng - line[i - 1].lng);
    seg.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) return lerp(line[i], line[i + 1], seg[i] ? Math.min(1, target / seg[i]) : 0);
    target -= seg[i];
  }
  return line[line.length - 1];
}
