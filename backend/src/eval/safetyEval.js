// Evaluation of the safety features — `npm run eval:safety`.
//
// Runs the real detector (utils/deviationDetector.js) on simulated trips
// between real hotspot pairs and measures:
//   1. false alarms on normal trips (GPS noise, multipath, traffic stops)
//   2. detection rate and delay for detours of 100 m – 2 km
//   3. detection delay for wrong-way driving and long unplanned stops
//   4. the cost of night mode — extra distance to the nearest night-safe
//      drop-off when the chosen spot is day-only
//   5. a property test of the fare guarantee: a new booking never raises
//      anyone else's fare (utils/pricing.js)
//
// Everything is seeded, so the numbers are reproducible. Writes a Markdown
// report to docs/safety-evaluation.md.
const fs = require('fs');
const path = require('path');
const detector = require('../utils/deviationDetector');
const { locate } = require('../utils/routeCorridor');
const { SAFE_HOTSPOTS, NIGHT_HOTSPOTS, nearestNightSafe } = require('../utils/hotspots');
const { haversineKm } = require('../utils/geo');
const { splitCosts } = require('../utils/pricing');

const SEED = 20261022;
const TRIPS = 400; // per condition
const SAMPLE_SEC = 3;
const M_PER_DEG = 111320;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const uniform = (a, b) => a + (b - a) * rand();
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// Local metres <-> lat/lng around a point.
function offset(p, eastM, northM) {
  return { lat: p.lat + northM / M_PER_DEG, lng: p.lng + eastM / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)) };
}

// A plausible winding road between two hotspots: the straight line plus a
// smooth sideways meander (two sine waves, up to ~8% of the trip length),
// one vertex every ~40 m. Stands in for ORS road geometry.
function makeRoad(a, b) {
  const km = haversineKm(a, b);
  const n = Math.max(10, Math.round((km * 1000) / 40));
  const amp1 = uniform(0.02, 0.08) * km * 1000;
  const amp2 = uniform(0, 0.02) * km * 1000;
  const k2 = Math.floor(uniform(2, 6));
  const phase = uniform(0, Math.PI);
  const dx = (b.lng - a.lng) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  const dy = (b.lat - a.lat) * M_PER_DEG;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const side = amp1 * Math.sin(Math.PI * t) * Math.sin(phase + Math.PI * t) + amp2 * Math.sin(k2 * Math.PI * t);
    pts.push(offset(a, dx * t + nx * side, dy * t + ny * side));
  }
  return pts;
}

// Point at distance `s` metres along the road, plus the road's unit
// direction there (east/north metres).
function along(road, cum, s) {
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = road[i - 1];
  const b = road[i];
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / segLen;
  const p = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  const ex = (b.lng - a.lng) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  const ny = (b.lat - a.lat) * M_PER_DEG;
  const l = Math.hypot(ex, ny) || 1;
  return { p, dir: { x: ex / l, y: ny / l } };
}

function cumulative(road) {
  const cum = [0];
  for (let i = 1; i < road.length; i++) cum.push(cum[i - 1] + haversineKm(road[i - 1], road[i]) * 1000);
  return cum;
}

const SAFE_STOP_KM = 0.15;
const isSafeStop = (p) => SAFE_HOTSPOTS.some((h) => haversineKm(h, p) <= SAFE_STOP_KM);

// Simulates one trip. `scenario` decides what the car does:
//   normal | detour (lateral D m) | wrong_way | long_stop
// Returns the first alert and the moment the "truth" became abnormal.
function simulate(road, { night, scenario, detourM = 0 }) {
  const corridor = detector.buildCorridor(road);
  const profile = detector.profileFor({ night, geometry: 'road', lengthM: corridor.lengthM });
  const ctx = { corridor, profile, isSafeStop };
  const cum = cumulative(road);
  const total = cum[cum.length - 1];

  let tracker = detector.newTracker();
  let t = 0;
  let s = 0; // metres along the road
  let lateral = 0; // metres off to the side (detours)
  let direction = 1;
  let stopLeft = 0;
  let abnormalAt = null; // when the car truly left normal behaviour
  let outsideAt = null; // when the true position first left the corridor
  const eventAt = uniform(0.2, 0.6) * total;
  let eventStarted = false;
  let urban = false;
  let lastStopS = -Infinity;
  const maxT = (total / 6 + 1800) * 1000;

  while (t < maxT) {
    t += SAMPLE_SEC * 1000;
    const speed = Math.max(2, uniform(7, 12)); // 25–43 km/h

    if (!eventStarted && s >= eventAt && scenario !== 'normal') {
      eventStarted = true;
      abnormalAt = t;
      if (scenario === 'long_stop') stopLeft = 15 * 60;
      if (scenario === 'wrong_way') direction = -1;
    }

    if (stopLeft > 0) {
      stopLeft -= SAMPLE_SEC;
    } else if (scenario === 'normal' && s - lastStopS > 300 && rand() < (SAMPLE_SEC * speed) / 2000) {
      // A traffic stop roughly every 2 km, at least 300 m after the last one.
      stopLeft = uniform(20, 150);
      lastStopS = s;
    } else if (eventStarted && scenario === 'detour') {
      // Turn off and drive away from the route at ~45°, then run parallel.
      if (lateral < detourM) lateral = Math.min(detourM, lateral + speed * SAMPLE_SEC * 0.7);
      s += speed * SAMPLE_SEC * 0.7;
    } else {
      s += direction * speed * SAMPLE_SEC;
    }
    if (s >= total || s <= 0) break;

    const { p, dir } = along(road, cum, s);
    const truth = offset(p, -dir.y * lateral, dir.x * lateral);
    if (outsideAt === null && eventStarted && locate(corridor, truth).offRouteM > profile.corridorM) outsideAt = t;

    // GPS: ~8 m noise, stretches of 25 m multipath, 2% wild 80 m jumps.
    if (rand() < 0.01) urban = !urban;
    const sigma = urban ? 25 : 8;
    const jump = rand() < 0.02 ? 80 : 0;
    const measured = offset(truth, gauss() * sigma + jump * (rand() - 0.5) * 2, gauss() * sigma + jump * (rand() - 0.5) * 2);
    const r = detector.step(tracker, { ...measured, t, accuracy: urban ? 25 : 10 }, ctx);
    tracker = r.tracker;
    if (r.trigger) {
      return { alert: r.trigger.type, alertAt: t, abnormalAt, outsideAt, durationSec: t / 1000 };
    }
  }
  return { alert: null, alertAt: null, abnormalAt, outsideAt, durationSec: t / 1000 };
}

function routePairs(n) {
  const pairs = [];
  while (pairs.length < n) {
    const a = pick(SAFE_HOTSPOTS);
    const b = pick(SAFE_HOTSPOTS);
    const km = haversineKm(a, b);
    if (a !== b && km >= 2 && km <= 25) pairs.push([a, b]);
  }
  return pairs;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const p90 = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
};
const secs = (x) => (x === null ? '—' : `${Math.round(x)} s`);

function run() {
  const roads = routePairs(TRIPS).map(([a, b]) => makeRoad(a, b));
  const lines = [];
  const out = (s = '') => {
    lines.push(s);
    console.log(s);
  };

  out('# VeriPool 2.o — safety evaluation');
  out();
  out(`Generated by \`npm run eval:safety\` (seed ${SEED}, ${TRIPS} simulated trips per row, GPS sample every ${SAMPLE_SEC} s).`);
  out('Trips run between random pairs of the 100 real hotspots (2–25 km apart) along a simulated winding road.');
  out('GPS noise: σ = 8 m, with stretches of σ = 25 m multipath and 2% sudden 80 m jumps; normal trips also stop at traffic about every 2 km (at least 300 m apart) for 20–150 s.');
  out();

  out('## Detector thresholds');
  out();
  out('| Profile | Corridor | Off-route for | Wrong way | Long stop | Rider must answer within |');
  out('|---|---|---|---|---|---|');
  for (const [name, p] of Object.entries(detector.PROFILES)) {
    out(`| ${name} | ${p.corridorM} m | ${p.offRouteSec} s | ${p.wrongWayM} m back | ${p.stopSec / 60} min | ${p.responseSec} s |`);
  }
  out();

  // 1. False alarms
  out('## 1. False alarms on normal trips');
  out();
  const falseTypes = {};
  out('| Profile | Trips | Trips with a false alert | False alerts per hour driven |');
  out('|---|---|---|---|');
  for (const night of [false, true]) {
    let alerts = 0;
    let hours = 0;
    for (const road of roads) {
      const r = simulate(road, { night, scenario: 'normal' });
      if (r.alert) { alerts++; falseTypes[r.alert] = (falseTypes[r.alert] || 0) + 1; }
      hours += r.durationSec / 3600;
    }
    out(`| ${night ? 'night' : 'day'} | ${roads.length} | ${alerts} (${pct(alerts / roads.length)}) | ${(alerts / hours).toFixed(3)} |`);
  }
  out();

  out(`False alerts by kind: ${Object.entries(falseTypes).map(([k, n]) => `${k.replace('_', ' ')} ${n}`).join(', ') || 'none'}.`);
  out();

  // 2. Detours
  out('## 2. Detours — detection rate and delay');
  out();
  out('Delay is measured from the moment the car turns off the route, and (in brackets) from the moment it is truly outside the corridor.');
  out('Detours narrower than the corridor are not meant to be caught.');
  out();
  out('| Detour | Profile | Detected | Median delay | 90th pct delay |');
  out('|---|---|---|---|---|');
  for (const detourM of [100, 200, 300, 500, 1000, 2000]) {
    for (const night of [false, true]) {
      let hit = 0;
      const fromTurn = [];
      const fromOutside = [];
      for (const road of roads) {
        const r = simulate(road, { night, scenario: 'detour', detourM });
        if (r.alert && r.abnormalAt !== null && r.alertAt >= r.abnormalAt) {
          hit++;
          fromTurn.push((r.alertAt - r.abnormalAt) / 1000);
          if (r.outsideAt !== null) fromOutside.push((r.alertAt - r.outsideAt) / 1000);
        }
      }
      out(
        `| ${detourM} m | ${night ? 'night' : 'day'} | ${pct(hit / roads.length)} | ${secs(median(fromTurn))} (${secs(median(fromOutside))}) | ${secs(p90(fromTurn))} (${secs(p90(fromOutside))}) |`
      );
    }
  }
  out();

  // 3. Wrong way & long stop
  out('## 3. Wrong-way driving and long unplanned stops');
  out();
  out('| Scenario | Profile | Detected | Median delay | 90th pct delay |');
  out('|---|---|---|---|---|');
  for (const scenario of ['wrong_way', 'long_stop']) {
    for (const night of [false, true]) {
      let hit = 0;
      let eligible = 0;
      const delays = [];
      for (const road of roads) {
        const r = simulate(road, { night, scenario });
        if (r.abnormalAt === null) continue;
        eligible++;
        if (r.alert && r.alertAt >= r.abnormalAt) {
          hit++;
          delays.push((r.alertAt - r.abnormalAt) / 1000);
        }
      }
      out(`| ${scenario.replace('_', ' ')} | ${night ? 'night' : 'day'} | ${pct(hit / Math.max(1, eligible))} | ${secs(median(delays))} | ${secs(p90(delays))} |`);
    }
  }
  out();
  out('Known limitation: stop-and-go jams where the car stands still for more than 3 min at night (5 min by day) will trigger a check-in. That is deliberate — answering costs the rider one tap.');
  out();
  out('Long stops are not flagged within 150 m of a hotspot or within 1 km of the drop-off, so some trips that stop near one are correctly left alone.');
  out();

  // 4. Night-mode cost
  out('## 4. Cost of night mode');
  out();
  out(`${NIGHT_HOTSPOTS.length} of ${SAFE_HOTSPOTS.length} hotspots are staffed all night. At night a rider who picks a day-only spot is offered the nearest night-safe one instead:`);
  out();
  out('| Area | Night-safe spots | Day-only spots | Median extra distance | Worst case |');
  out('|---|---|---|---|---|');
  const areas = [...new Set(SAFE_HOTSPOTS.map((h) => h.area))];
  const allExtra = [];
  for (const area of areas) {
    const inArea = SAFE_HOTSPOTS.filter((h) => h.area === area);
    const dayOnly = inArea.filter((h) => !h.night);
    const extra = dayOnly.map((h) => nearestNightSafe(h, 1)[0].km);
    allExtra.push(...extra);
    out(`| ${area} | ${inArea.length - dayOnly.length} | ${dayOnly.length} | ${extra.length ? median(extra).toFixed(2) + ' km' : '—'} | ${extra.length ? Math.max(...extra).toFixed(2) + ' km' : '—'} |`);
  }
  out(`| **All** | ${NIGHT_HOTSPOTS.length} | ${allExtra.length} | ${median(allExtra).toFixed(2)} km | ${Math.max(...allExtra).toFixed(2)} km |`);
  out();

  // 5. Fare guarantee
  out('## 5. Fare guarantee — property test');
  out();
  const TRIALS = 20000;
  let raised = 0;
  let driverPaidNothing = 0;
  for (let i = 0; i < TRIALS; i++) {
    const nLegs = 1 + Math.floor(rand() * 6);
    const legs = Array.from({ length: nLegs }, () => ({ km: uniform(0.5, 12) }));
    const randomBooking = () => {
      const board = Math.floor(rand() * nLegs);
      const alight = board + 1 + Math.floor(rand() * (nLegs - board));
      return { seats: 1 + Math.floor(rand() * 3), boardIndex: board, alightIndex: alight };
    };
    const bookings = Array.from({ length: Math.floor(rand() * 5) }, randomBooking);
    const before = splitCosts(legs, bookings).fares;
    const after = splitCosts(legs, [...bookings, randomBooking()]);
    if (before.some((f, k) => after.fares[k] > f + 1e-9)) raised++;
    if (after.driverShare <= 0) driverPaidNothing++;
  }
  out(`${TRIALS.toLocaleString('en-IN')} random rides (1–6 legs, 0–4 existing bookings of 1–3 seats, then one more booking):`);
  out();
  out(`- existing riders whose fare went **up** after a new booking: **${raised}**`);
  out(`- rides where the driver's own share was zero or negative (i.e. the driver profited): **${driverPaidNothing}**`);
  out();
  out('Why it holds: on every leg the cost is split as cost ÷ (seats on board + 1). A new booking only adds seats to the legs it covers, so each share on those legs can only shrink, and the "+1" is the driver, who always carries a share.');

  const file = path.join(__dirname, '..', '..', '..', 'docs', 'safety-evaluation.md');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), file)}`);
}

run();
