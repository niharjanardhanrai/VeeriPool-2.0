// Route corridor — how far the car is from the route it was supposed to
// take, and how far along it is. Pure geometry, no database: the safety
// monitor (services/safetyMonitor.js) and the evaluation script
// (src/eval/safetyEval.js) both use it.
//
// Distances use a local flat projection (metres east/north of the route's
// first point). Over the ~40 km this app covers the error is well under a
// metre, and it makes point-to-segment distance a few multiplications.
const M_PER_DEG_LAT = 111320;

function projector(origin) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return (p) => ({ x: (p.lng - origin.lng) * mPerDegLng, y: (p.lat - origin.lat) * M_PER_DEG_LAT });
}

// Prepares a polyline once per ride: projected vertices plus the distance
// along the route at each vertex.
function buildCorridor(waypoints) {
  if (!waypoints || waypoints.length < 2) throw new Error('A corridor needs at least two route points');
  const project = projector(waypoints[0]);
  const pts = waypoints.map(project);
  const along = [0];
  for (let i = 1; i < pts.length; i++) {
    along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { project, pts, along, lengthM: along[along.length - 1] };
}

// Distance (m) from `point` to the nearest spot on the route, and how far
// along the route (m) that nearest spot is.
function locate(corridor, point) {
  const p = corridor.project(point);
  let bestD = Infinity;
  let bestAlong = 0;
  const { pts, along } = corridor;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < bestD) {
      bestD = d;
      bestAlong = along[i] + t * Math.sqrt(len2);
    }
  }
  return { offRouteM: bestD, alongM: bestAlong };
}

function distanceM(a, b) {
  const project = projector(a);
  const q = project(b);
  return Math.hypot(q.x, q.y);
}

module.exports = { buildCorridor, locate, distanceM };
