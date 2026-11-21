// Turn-by-turn directions for the full-screen map. Uses OSRM — the free,
// open-source routing engine on OpenStreetMap data — via its public demo
// server (no key; fair-use policy: light traffic only, so results are
// cached). If OSRM can't be reached we return a straight line through the
// stops with no steps, so the map still works.
const { haversineKm } = require('./geo');

const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, result }

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

function compass(bearing) {
  return COMPASS[Math.round(((bearing % 360) + 360) / 45) % 8];
}

function onto(name) {
  return name ? ` onto ${name}` : '';
}

// OSRM gives maneuver types/modifiers, not sentences — turn them into the
// short instructions a driver expects.
function instruction(step) {
  const { type, modifier, bearing_after: bearing, exit } = step.maneuver;
  const name = step.name || step.ref || '';
  const dir = modifier || 'straight';
  switch (type) {
    case 'depart':
      return `Head ${compass(bearing)}${name ? ` on ${name}` : ''}`;
    case 'arrive':
      return 'Arrive at your stop';
    case 'turn':
      if (dir === 'uturn') return `Make a U-turn${onto(name)}`;
      if (dir === 'straight') return `Go straight${onto(name)}`;
      return `Turn ${dir}${onto(name)}`;
    case 'new name':
      return `Continue${onto(name)}`;
    case 'continue':
      return dir === 'straight' ? `Continue straight${onto(name)}` : `Keep ${dir}${onto(name)}`;
    case 'merge':
      return `Merge ${dir}${onto(name)}`;
    case 'on ramp':
      return `Take the ramp on the ${dir.replace('slight ', '')}${onto(name)}`;
    case 'off ramp':
      return `Take the exit on the ${dir.replace('slight ', '')}${onto(name)}`;
    case 'fork':
      return `Keep ${dir.replace('slight ', '')} at the fork${onto(name)}`;
    case 'end of road':
      return `At the end of the road, turn ${dir}${onto(name)}`;
    case 'roundabout':
    case 'rotary':
      return exit ? `At the roundabout, take the ${ORDINAL[exit - 1] || `${exit}th`} exit${onto(name)}` : `Enter the roundabout${onto(name)}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Exit the roundabout${onto(name)}`;
    default:
      return `Continue${onto(name)}`;
  }
}

function straightLine(points) {
  const legs = points.slice(1).map((p, i) => haversineKm(points[i], p));
  const km = legs.reduce((s, x) => s + x, 0);
  return {
    source: 'straight',
    distanceKm: Math.round(km * 100) / 100,
    durationMin: Math.max(1, Math.round((km / 30) * 60)),
    geometry: points.map(({ lat, lng }) => ({ lat, lng })),
    steps: [],
  };
}

async function osrm(points) {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VeriPool2-student-project/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route) throw new Error(`OSRM ${data.code}`);

  const steps = [];
  route.legs.forEach((leg, legIndex) => {
    for (const step of leg.steps) {
      // An "arrive" mid-route is just reaching a stop — kept, so the list
      // shows each stop; the zero-length depart that follows it is noise.
      if (step.maneuver.type === 'depart' && legIndex > 0) continue;
      const [lng, lat] = step.maneuver.location;
      steps.push({
        instruction: instruction(step),
        type: step.maneuver.type,
        modifier: step.maneuver.modifier || null,
        distanceM: Math.round(step.distance),
        durationS: Math.round(step.duration),
        location: { lat, lng },
        legIndex,
      });
    }
  });

  return {
    source: 'osrm',
    distanceKm: Math.round((route.distance / 1000) * 100) / 100,
    durationMin: Math.max(1, Math.round(route.duration / 60)),
    geometry: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    steps,
  };
}

// points: [{ lat, lng }, ...] in travel order. Always resolves.
async function getDirections(points) {
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  let result;
  try {
    result = await osrm(points);
  } catch (err) {
    console.warn('Directions: OSRM unavailable, using straight line:', err.message);
    return straightLine(points); // not cached, so the next request retries OSRM
  }
  cache.set(key, { at: Date.now(), result });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { getDirections };
