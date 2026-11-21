// Route planning for posted rides. A driver's route is a chain of safe
// hotspots — every stop on it is somewhere a rider can safely board or be
// dropped off — so planning a route means finding a good path through the
// hotspot graph.
//
// 1. Graph (built once at startup): every hotspot is joined to its
//    K_NEIGHBOURS nearest hotspots, found with a geohash index instead of
//    comparing all pairs (see geohash.js GeohashIndex.nearest). Any
//    disconnected clusters (the three towns) are then bridged by their
//    closest pair, so every hotspot can reach every other one.
// 2. Each stop gets a catchment: its precision-6 geohash cell (~1.2 × 0.6 km)
//    plus the 8 around it — everywhere a rider can walk to that stop from.
// 3. A* search over that graph, with a straight-line (haversine) heuristic.
//    Two cost functions give two route options:
//      • Fastest     — road-km plus a small per-stop penalty, so the path
//                      doesn't zig-zag through every hotspot in town.
//      • Most riders — the same, but the edge into a stop is discounted (up
//                      to DEMAND_WEIGHT) for every waiting rider inside that
//                      stop's catchment, so the route bends towards people
//                      who need a ride when the detour is small.
//    The heuristic is scaled by (1 − DEMAND_WEIGHT) so it never over-estimates
//    a discounted edge — A* stays optimal for both cost functions.
//    Plus a Direct option (no intermediate stops) and a Custom option that
//    chains A* legs through stops the driver picked.
const { haversineKm } = require('./geo');
const { SAFE_HOTSPOTS, getHotspot } = require('./hotspots');
const { GeohashIndex, cellsAlongPath, encode, searchArea } = require('./geohash');

const ROAD_FACTOR = 1.3; // straight line -> typical road distance (haversine fallback)
const STOP_PENALTY_KM = 0.4;
const K_NEIGHBOURS = 4;
const DEMAND_WEIGHT = 0.35;
const DEMAND_SATURATION = 3; // riders at a stop for the full discount
const CELL_PRECISION = 6;

function legDuration(km) {
  // Town streets vs. the SH1/NH66 stretches between towns.
  const speedKmh = km > 3 ? 40 : 22;
  return (km / speedKmh) * 60;
}

// ---------- graph ----------

const index = new GeohashIndex(SAFE_HOTSPOTS);
const adjacency = new Map(SAFE_HOTSPOTS.map((h) => [h.id, new Map()])); // id -> Map(id -> edge)

function addEdge(a, b) {
  if (a.id === b.id || adjacency.get(a.id).has(b.id)) return;
  const edge = { km: haversineKm(a, b) * ROAD_FACTOR };
  adjacency.get(a.id).set(b.id, edge);
  adjacency.get(b.id).set(a.id, edge);
}

for (const h of SAFE_HOTSPOTS) {
  for (const { item } of index.nearest(h, K_NEIGHBOURS, haversineKm, h)) addEdge(h, item);
}

function components() {
  const seen = new Set();
  const groups = [];
  for (const h of SAFE_HOTSPOTS) {
    if (seen.has(h.id)) continue;
    const group = [];
    const stack = [h.id];
    seen.add(h.id);
    while (stack.length) {
      const id = stack.pop();
      group.push(getHotspot(id));
      for (const next of adjacency.get(id).keys()) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

// Bridge clusters until the graph is connected (closest pair each time).
for (let groups = components(); groups.length > 1; groups = components()) {
  const [first, ...rest] = groups;
  let best = null;
  for (const a of first) {
    for (const group of rest) {
      for (const b of group) {
        const km = haversineKm(a, b);
        if (!best || km < best.km) best = { a, b, km };
      }
    }
  }
  addEdge(best.a, best.b);
}

const catchment = new Map(SAFE_HOTSPOTS.map((h) => [h.id, searchArea(h, CELL_PRECISION)]));

// ---------- search ----------

function ridersAround(cells, demand) {
  if (!demand || demand.size === 0) return 0;
  return cells.reduce((sum, c) => sum + (demand.get(c) || 0), 0);
}

function edgeCost(edge, nextId, demand) {
  const waiting = ridersAround(catchment.get(nextId), demand);
  const discount = DEMAND_WEIGHT * Math.min(1, waiting / DEMAND_SATURATION);
  return edge.km * (1 - discount) + STOP_PENALTY_KM;
}

// Plain binary-heap-free A*: the graph has 60 nodes, so a linear scan of
// the open set is fast and keeps the code readable.
// `avoid`: stops already used by earlier legs of a custom route, skipped
// so the route never passes the same hotspot twice.
function aStar(fromId, toId, demand, avoid = new Set()) {
  const goal = getHotspot(toId);
  const heuristicScale = ROAD_FACTOR * (demand && demand.size ? 1 - DEMAND_WEIGHT : 1);
  const h = (id) => haversineKm(getHotspot(id), goal) * heuristicScale;

  const g = new Map([[fromId, 0]]);
  const cameFrom = new Map();
  const open = new Set([fromId]);
  const closed = new Set();

  while (open.size) {
    let current = null;
    let bestF = Infinity;
    for (const id of open) {
      const f = g.get(id) + h(id);
      if (f < bestF) {
        bestF = f;
        current = id;
      }
    }
    if (current === toId) {
      const path = [current];
      while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0]));
      return path;
    }
    open.delete(current);
    closed.add(current);

    for (const [next, edge] of adjacency.get(current)) {
      if (closed.has(next) || (avoid.has(next) && next !== toId)) continue;
      const tentative = g.get(current) + edgeCost(edge, next, demand);
      if (tentative < (g.has(next) ? g.get(next) : Infinity)) {
        cameFrom.set(next, current);
        g.set(next, tentative);
        open.add(next);
      }
    }
  }
  return null;
}

// ---------- route options ----------

function describe(key, label, stopIds, demand) {
  const stops = stopIds.map((id) => {
    const h = getHotspot(id);
    return { hotspotId: h.id, label: h.label, area: h.area, lat: h.lat, lng: h.lng };
  });
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const km = haversineKm(stops[i], stops[i + 1]) * ROAD_FACTOR;
    legs.push({ km: Math.round(km * 100) / 100, min: Math.round(legDuration(km) * 10) / 10 });
  }
  const pathCells = cellsAlongPath(stops, CELL_PRECISION);
  // Riders who could walk to a stop where they can still board (not the last).
  const boardCells = new Set(stopIds.slice(0, -1).flatMap((id) => catchment.get(id)));
  const ridersNearby = ridersAround([...boardCells], demand);
  const distanceKm = Math.round(legs.reduce((s, l) => s + l.km, 0) * 100) / 100;
  const durationMin = Math.max(1, Math.round(legs.reduce((s, l) => s + l.min, 0) + (stops.length - 2) * 0.5));
  return { key, label, stops, legs, distanceKm, durationMin, ridersNearby, pathCells };
}

function sameStops(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// demand: Map(geohash6 -> waiting riders). viaIds: optional stops the
// driver wants to pass through, in order.
function planRoutes(fromId, toId, { demand = new Map(), viaIds = [] } = {}) {
  if (!getHotspot(fromId) || !getHotspot(toId)) throw new Error('Unknown hotspot');
  if (fromId === toId) throw new Error('Start and destination must be different');

  const options = [];
  const fastest = aStar(fromId, toId, null);
  options.push(describe('fastest', 'Fastest', fastest, demand));

  if (demand.size) {
    const busy = aStar(fromId, toId, demand);
    if (busy && !sameStops(busy, fastest)) options.push(describe('demand', 'Most riders on the way', busy, demand));
  }

  if (fastest.length > 2) options.push(describe('direct', 'Direct (no stops)', [fromId, toId], demand));

  const vias = [...new Set(viaIds)].filter((id) => getHotspot(id) && id !== fromId && id !== toId);
  if (vias.length) {
    const chain = [fromId, ...vias, toId];
    let path = [fromId];
    for (let i = 0; i < chain.length - 1; i++) {
      const avoid = new Set([...path, ...chain.slice(i + 2)]);
      const leg = aStar(chain[i], chain[i + 1], null, avoid) || [chain[i], chain[i + 1]];
      path = path.concat(leg.slice(1));
    }
    options.push(describe('custom', 'Your route', path, demand));
  }

  return options;
}

// Validates and describes a driver-chosen chain of stops exactly as given.
function describeStops(stopIds, key = 'custom', demand = new Map()) {
  if (!Array.isArray(stopIds) || stopIds.length < 2) throw new Error('A route needs at least two stops');
  if (stopIds.some((id) => !getHotspot(id))) throw new Error('Every stop must be a safe hotspot');
  if (new Set(stopIds).size !== stopIds.length) throw new Error('A stop cannot appear twice on the route');
  return describe(key, key, stopIds, demand);
}

function demandFromPoints(points) {
  const demand = new Map();
  for (const p of points) {
    const cell = encode(p.lat, p.lng, CELL_PRECISION);
    demand.set(cell, (demand.get(cell) || 0) + 1);
  }
  return demand;
}

function graphStats() {
  let edges = 0;
  for (const m of adjacency.values()) edges += m.size;
  return { nodes: SAFE_HOTSPOTS.length, edges: edges / 2 };
}

module.exports = { planRoutes, describeStops, demandFromPoints, graphStats, CELL_PRECISION };
