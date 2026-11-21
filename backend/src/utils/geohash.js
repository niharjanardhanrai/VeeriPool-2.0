// Geohash — encodes a lat/lng as a short base-32 string by repeatedly
// halving the world: each bit says "upper or lower half" of longitude, then
// latitude, alternating. Points that share a prefix share a grid cell, so a
// prefix is a cheap spatial bucket:
//
//   precision 4 ≈ 39 km × 19.5 km   (whole region: Nitte–Karkala)
//   precision 5 ≈ 4.9 km × 4.9 km   (a town)
//   precision 6 ≈ 1.2 km × 0.61 km  (a neighbourhood — used for matching)
//   precision 7 ≈ 153 m × 153 m     (a street corner)
//
// Used for (1) nearest-hotspot lookups when building the route graph,
// (2) tagging each posted ride with the cells its route passes through, so
// "which rides pass near me?" is an indexed array lookup in MongoDB instead
// of a scan of every ride, and (3) counting waiting riders per cell for the
// demand-aware route option (see routePlanner.js).
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEX = Object.fromEntries([...BASE32].map((c, i) => [c, i]));

function encode(lat, lng, precision = 6) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true; // even bits split longitude, odd bits split latitude

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

// The cell's bounding box.
function bounds(hash) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true;

  for (const c of hash) {
    const idx = BASE32_INDEX[c];
    if (idx === undefined) throw new Error(`Invalid geohash: ${hash}`);
    for (let n = 4; n >= 0; n--) {
      const bitN = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lngMin + lngMax) / 2;
        if (bitN) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitN) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { latMin, latMax, lngMin, lngMax };
}

function decode(hash) {
  const b = bounds(hash);
  return {
    lat: (b.latMin + b.latMax) / 2,
    lng: (b.lngMin + b.lngMax) / 2,
    latErr: (b.latMax - b.latMin) / 2,
    lngErr: (b.lngMax - b.lngMin) / 2,
  };
}

// The 8 surrounding cells. Computed by stepping one cell-width from the
// centre and re-encoding — simpler than the classic lookup tables and
// plenty fast at this scale.
function neighbors(hash) {
  const { lat, lng, latErr, lngErr } = decode(hash);
  const out = [];
  for (const dLat of [-1, 0, 1]) {
    for (const dLng of [-1, 0, 1]) {
      if (dLat === 0 && dLng === 0) continue;
      out.push(encode(lat + dLat * latErr * 2, lng + dLng * lngErr * 2, hash.length));
    }
  }
  return out;
}

// The cell plus its 8 neighbours — the standard "search area" around a
// point, which covers anything within one cell-width regardless of where
// inside its own cell the point sits.
function searchArea(point, precision = 6) {
  const h = encode(point.lat, point.lng, precision);
  return [h, ...neighbors(h)];
}

// Every cell a polyline passes through, sampled at a quarter of the cell
// size so no cell along the way is skipped.
function cellsAlongPath(points, precision = 6) {
  const cells = new Set();
  if (!points.length) return [];
  const { latErr, lngErr } = decode(encode(points[0].lat, points[0].lng, precision));
  const step = Math.min(latErr, lngErr) / 2; // a quarter of the cell's short side, in degrees

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    cells.add(encode(a.lat, a.lng, precision));
    const b = points[i + 1];
    if (!b) break;
    const span = Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lng - a.lng));
    const n = Math.ceil(span / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      cells.add(encode(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t, precision));
    }
  }
  return [...cells];
}

// A static spatial index: items bucketed by geohash. nearest() looks in the
// point's cell and its neighbours, and only widens to a coarser precision
// when that ring doesn't hold enough candidates — so a lookup touches a
// handful of items, not all of them.
class GeohashIndex {
  constructor(items, precisions = [6, 5, 4, 3]) {
    this.precisions = precisions;
    this.buckets = new Map(); // `${precision}:${hash}` -> items[]
    for (const item of items) {
      for (const p of precisions) {
        const key = `${p}:${encode(item.lat, item.lng, p)}`;
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(item);
      }
    }
    this.all = items;
  }

  candidates(point, precision) {
    const seen = new Set();
    for (const h of searchArea(point, precision)) {
      for (const item of this.buckets.get(`${precision}:${h}`) || []) seen.add(item);
    }
    return [...seen];
  }

  // k nearest items to `point` (excluding `exclude`), as [{ item, km }].
  // The 3×3 ring is only guaranteed to contain everything within one cell
  // side of the point, so a result is accepted only when the k-th hit is
  // inside that radius — otherwise widen, so the answer is exact.
  nearest(point, k, distanceFn, exclude = null) {
    for (const p of this.precisions) {
      const found = this.candidates(point, p).filter((i) => i !== exclude);
      if (found.length < k) continue;
      const ranked = found
        .map((item) => ({ item, km: distanceFn(point, item) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, k);
      const { latErr, lngErr } = decode(encode(point.lat, point.lng, p));
      const safeKm = Math.min(latErr * 2 * 111, lngErr * 2 * 111 * Math.cos((point.lat * Math.PI) / 180));
      if (ranked[k - 1].km <= safeKm) return ranked;
    }
    return this.all
      .filter((i) => i !== exclude)
      .map((item) => ({ item, km: distanceFn(point, item) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, k);
  }
}

module.exports = { encode, decode, bounds, neighbors, searchArea, cellsAlongPath, GeohashIndex };
