// Routing engine for the app. The paper uses OpenRouteService (ORS), a free
// API (2000 req/day, no credit card — https://openrouteservice.org/dev/#/signup),
// built on GraphHopper/Dijkstra/A* (Sec. II-A "Routing"). This file calls the
// real ORS API when ORS_API_KEY is set in the environment, and falls back to
// a haversine great-circle straight line when it isn't — so the app runs
// with zero configuration, and upgrades to real optimized routing the
// moment a free key is added.
const EARTH_RADIUS_KM = 6371;
const ASSUMED_AVERAGE_SPEED_KMH = 22; // used only by the haversine fallback

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
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

function haversineFallback(origin, destination) {
  const distanceKm = Math.round(haversineKm(origin, destination) * 100) / 100;
  const durationMin = Math.max(1, Math.round((distanceKm / ASSUMED_AVERAGE_SPEED_KMH) * 60));
  return {
    distanceKm,
    durationMin,
    waypoints: [origin, destination],
    source: 'haversine',
  };
}

// points: two or more stops in order. ORS returns one "segment" per leg,
// which multi-stop posted rides use for per-leg distances (fair pricing).
async function orsRoute(points) {
  const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: process.env.ORS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      coordinates: points.map((p) => [p.lng, p.lat]),
    }),
  });

  if (!res.ok) {
    throw new Error(`ORS request failed: ${res.status}`);
  }

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error('ORS returned no route');

  const summary = feature.properties.summary; // { distance: meters, duration: seconds }
  const waypoints = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));

  const legs = (feature.properties.segments || []).map((seg) => ({
    km: Math.round((seg.distance / 1000) * 100) / 100,
    min: Math.round((seg.duration / 60) * 10) / 10,
  }));

  return {
    distanceKm: Math.round((summary.distance / 1000) * 100) / 100,
    durationMin: Math.max(1, Math.round(summary.duration / 60)),
    waypoints,
    legs,
    source: 'ors',
  };
}

// Public entry point used by the ride controller. Always resolves — never
// throws — so a flaky/missing ORS key never blocks a ride request; it just
// silently drops back to the straight-line estimate.
async function estimateRoute(origin, destination) {
  if (process.env.ORS_API_KEY) {
    try {
      const { legs, ...route } = await orsRoute([origin, destination]);
      return route;
    } catch (err) {
      console.warn('ORS routing failed, falling back to haversine:', err.message);
    }
  }
  return haversineFallback(origin, destination);
}

// Real road geometry through several stops, or null when ORS isn't
// configured / fails (callers keep their own straight-line estimate).
async function roadRouteVia(points) {
  if (!process.env.ORS_API_KEY) return null;
  try {
    const route = await orsRoute(points);
    return route.legs.length === points.length - 1 ? route : null;
  } catch (err) {
    console.warn('ORS multi-stop routing failed, using straight-line legs:', err.message);
    return null;
  }
}

module.exports = { haversineKm, estimateRoute, roadRouteVia };
