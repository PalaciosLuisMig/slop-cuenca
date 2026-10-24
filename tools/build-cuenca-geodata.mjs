// tools/build-cuenca-geodata.mjs — writes js/cuenca-geodata.js from the OpenStreetMap extracts in tools/data/cuenca/
// usage: node --max-old-space-size=8192 tools/build-cuenca-geodata.mjs [out.js]
//
// Frame: 1 unit = 1 m, x = grid east, z = grid south (north = -z), origin at Parque Calderón (Cuenca's main square).
// The axes are turned THETA from true north to follow the colonial street grid (measured from the road bearings).
// Output keeps the shape of GEO in js/nyc-geodata.js where the game needs it (roads, roadGraph, blocks, parks,
// landmarks, frame) and adds `water`, `rivers` and per-lot building heights.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/cuenca/', import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL('../js/cuenca-geodata.js', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).elements;
const log = (...a) => console.log('[cuenca-geodata]', ...a);
const r1 = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// =====================================================================================================================
// 1. FRAME
// =====================================================================================================================
const LAT0 = -2.89737;
const LON0 = -79.00446;
const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180;
const S0 = Math.sin(PHI0);
const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * S0 * S0)) * Math.cos(PHI0);
const KY = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * S0 * S0, 1.5));
const enu = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];
let THETA = 0;
const toWorld = (lon, lat) => {
  const [e, n] = enu(lon, lat);
  const c = Math.cos(THETA);
  const s = Math.sin(THETA);
  return [e * c - n * s, -(e * s + n * c)];
};

// =====================================================================================================================
// 2. GEOMETRY HELPERS
// =====================================================================================================================
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1 };
}
const centroid = (r) => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function rdpRing(ring, eps) {
  let far = 0, i1 = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > far) { far = d; i1 = i; }
  }
  const a = rdp(ring.slice(0, i1 + 1), eps);
  const b = rdp([...ring.slice(i1), ring[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
const geom = (e) => (e.geometry || []).map((g) => toWorld(g.lon, g.lat));
// Outer rings of a way or multipolygon relation (several outer ways are chained into closed rings)
function outerRings(e, role = 'outer') {
  if (e.type === 'way') return role === 'outer' ? [geom(e)] : [];
  const parts = (e.members || []).filter((m) => m.role === role && m.geometry).map((m) => m.geometry.map((g) => toWorld(g.lon, g.lat)));
  const rings = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 500 && !close(ring[0], ring[ring.length - 1]); guard++) {
      const i = parts.findIndex((p) => close(p[0], ring[ring.length - 1]) || close(p[p.length - 1], ring[ring.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(close(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
    }
    rings.push(ring);
  }
  return rings;
}
const closedRing = (r) => r.length > 3 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5;

// =====================================================================================================================
// 3. ROADS & FRAME BEARING
// =====================================================================================================================
const HW = {
  trunk: [18, 4, 1], trunk_link: [9, 1, 1], primary: [14, 4, 0], primary_link: [8, 1, 0], secondary: [11, 2, 0], secondary_link: [7, 1, 0],
  tertiary: [9, 2, 0], tertiary_link: [6, 1, 0], residential: [7, 2, 0], unclassified: [7, 2, 0], living_street: [5.5, 1, 0],
  service: [4.5, 1, 0], pedestrian: [5, 1, 0], track: [3.5, 1, 0], rest_area: [5, 1, 0]
};
const osmRoads = load('osm_roads.json').filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 1 && HW[e.tags.highway]);
{
  // Bearing: circular mean (period 90°) of the road directions within 1.2 km of the square, length weighted
  let sx = 0, sy = 0;
  for (const e of osmRoads) {
    if (!/^(residential|secondary|tertiary|primary|unclassified|living_street)$/.test(e.tags.highway)) continue;
    for (let i = 0; i + 1 < e.geometry.length; i++) {
      const [e0, n0] = enu(e.geometry[i].lon, e.geometry[i].lat);
      const [e1, n1] = enu(e.geometry[i + 1].lon, e.geometry[i + 1].lat);
      if (Math.hypot(e0, n0) > 1200) continue;
      const L = Math.hypot(e1 - e0, n1 - n0);
      if (L < 8) continue;
      const a = Math.atan2(e1 - e0, n1 - n0);
      sx += L * Math.cos(4 * a);
      sy += L * Math.sin(4 * a);
    }
  }
  THETA = Math.atan2(sy, sx) / 4; // radians east of true north, folded into (-45°, 45°]
  log(`grid bearing ${((THETA * 180) / Math.PI).toFixed(2)}° from true north`);
}
const widthOf = (t) => {
  const base = HW[t.highway];
  const lanes = parseInt(t.lanes || '0', 10) || base[1];
  return { w: t.width ? parseFloat(t.width) || base[0] : Math.max(base[0], lanes * 3.2 + (lanes > 2 ? 1 : 0)), lanes };
};
const dirOf = (t) => (t.oneway === 'yes' || t.oneway === '1' ? 1 : t.oneway === '-1' ? -1 : 0);
const roads = [];
for (const e of osmRoads) {
  const t = e.tags;
  const { w, lanes } = widthOf(t);
  const pts = rdp(geom(e), 0.6);
  roads.push({ e, name: t.name || t.ref || '', w, lanes, dir: dirOf(t), hw: HW[t.highway][2], bridge: !!(t.bridge || t.tunnel), pts });
}
log(`${roads.length} roads`);

// Street centreline graph: ways cut at the OSM nodes shared by two or more ways
const nodeUse = new Map();
for (const e of osmRoads) for (const id of e.nodes) nodeUse.set(id, (nodeUse.get(id) || 0) + 1);
const gNodes = [];
const gIndex = new Map();
const gNames = [];
const gNameIds = new Map();
const gLinks = [];
const gNode = (id, p) => {
  if (!gIndex.has(id)) { gIndex.set(id, gNodes.length / 2); gNodes.push(r1(p[0]), r1(p[1])); }
  return gIndex.get(id);
};
for (const e of osmRoads) {
  const t = e.tags;
  if (/^(pedestrian|track|rest_area)$/.test(t.highway)) continue;
  const { w, lanes } = widthOf(t);
  const name = t.name || t.ref || '';
  if (!gNameIds.has(name)) { gNameIds.set(name, gNames.length); gNames.push(name); }
  const pts = geom(e);
  let start = 0;
  for (let i = 1; i < e.nodes.length; i++) {
    if (i < e.nodes.length - 1 && nodeUse.get(e.nodes[i]) < 2) continue;
    const a = gNode(e.nodes[start], pts[start]);
    const b = gNode(e.nodes[i], pts[i]);
    if (a !== b) {
      const seg = rdp(pts.slice(start, i + 1), 0.5);
      gLinks.push([a, b, gNameIds.get(name), r1(w), lanes, dirOf(t), flat(seg.slice(1, -1))]);
    }
    start = i;
  }
}
log(`road graph: ${gNodes.length / 2} nodes, ${gLinks.length} links`);

// =====================================================================================================================
// 4. WATER, PARKS
// =====================================================================================================================
const osmWater = load('osm_water.json');
const rivers = [];
const water = [];
for (const e of osmWater) {
  const t = e.tags || {};
  if (t.waterway && e.type === 'way') {
    rivers.push({ name: t.name || '', w: t.waterway === 'river' ? 14 : t.waterway === 'canal' ? 6 : 3, pts: flat(rdp(geom(e), 0.8)) });
  } else if (t.natural === 'water' || t.landuse === 'reservoir' || t.riverbank) {
    for (const r of outerRings(e)) {
      if (!closedRing(r) || Math.abs(ringArea(r)) < 100) continue;
      const s = rdpRing(r.slice(0, -1), 0.8);
      if (ringArea(s) > 0) s.reverse();
      water.push({ name: t.name || '', ring: flat(s) });
    }
  }
}
log(`${rivers.length} river lines, ${water.length} water bodies`);

const parks = [];
const parkRings = [];
for (const e of load('osm_parks.json')) {
  const t = e.tags || {};
  const cat = t.leisure || t.landuse || t.natural;
  const rings = outerRings(e).filter((r) => closedRing(r) && Math.abs(ringArea(r)) > 300);
  if (!rings.length) continue;
  const simplified = rings.map((r) => {
    const s = rdpRing(r.slice(0, -1), 1.2);
    if (ringArea(s) > 0) s.reverse();
    return s;
  });
  const area = simplified.reduce((a, r) => a + Math.abs(ringArea(r)), 0);
  parks.push({ name: t.name || '', cat, acres: Math.round(area / 4046.86), rings: simplified.map(flat) });
  if (/^(park|garden|recreation_ground|grass|forest|wood|cemetery)$/.test(cat)) for (const s of simplified) parkRings.push({ name: t.name || '', ring: s });
}
log(`${parks.length} parks`);

// =====================================================================================================================
// 5. BLOCKS: land between roadways, found on a raster, with the OSM buildings as lots
// =====================================================================================================================
const RES = 2;
const world = [];
for (const r of roads) for (const p of r.pts) world.push(p);
const wb = bbox(world);
const X0 = Math.floor((wb.x0 - 40) / RES) * RES;
const Z0 = Math.floor((wb.z0 - 40) / RES) * RES;
const W = Math.ceil((wb.x1 + 40 - X0) / RES) + 1;
const H = Math.ceil((wb.z1 + 40 - Z0) / RES) + 1;
const land = new Uint8Array(W * H).fill(1);
function stampDisc(x, z, rad) {
  const i0 = Math.max(0, Math.floor((x - rad - X0) / RES)), i1 = Math.min(W - 1, Math.ceil((x + rad - X0) / RES));
  const j0 = Math.max(0, Math.floor((z - rad - Z0) / RES)), j1 = Math.min(H - 1, Math.ceil((z + rad - Z0) / RES));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = X0 + (i + 0.5) * RES - x, dz = Z0 + (j + 0.5) * RES - z;
      if (dx * dx + dz * dz <= rad * rad) land[j * W + i] = 0;
    }
  }
}
function stampLine(pts, width) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / (RES * 0.5)));
    for (let s = 0; s <= n; s++) stampDisc(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, width / 2);
  }
}
for (const r of roads) {
  if (r.bridge || /^(pedestrian|track|rest_area|service)$/.test(r.e.tags.highway)) continue;
  stampLine(r.pts, r.w);
}
for (const rv of rivers) {
  const pts = [];
  for (let i = 0; i < rv.pts.length; i += 2) pts.push([rv.pts[i], rv.pts[i + 1]]);
  stampLine(pts, rv.w);
}
function fillRing(ring, val) {
  const bb = bbox(ring);
  const j0 = Math.max(0, Math.floor((bb.z0 - Z0) / RES)), j1 = Math.min(H - 1, Math.ceil((bb.z1 - Z0) / RES));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = Z0 + (j + 0.5) * RES;
    xs.length = 0;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [xa, za] = ring[k];
      const [xb, zb] = ring[i];
      if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((p, q) => p - q);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - X0) / RES - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[n + 1] - X0) / RES - 0.5));
      for (let i = i0; i <= i1; i++) land[j * W + i] = val;
    }
  }
}
for (const w of water) {
  const r = [];
  for (let i = 0; i < w.ring.length; i += 2) r.push([w.ring[i], w.ring[i + 1]]);
  fillRing(r, 0);
}

// Connected components of land (4-neighbour) -> labels
const label = new Int32Array(W * H);
const comps = [];
{
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!land[s] || label[s]) continue;
    const id = comps.length + 1;
    let n = 0, i0 = W, i1 = 0, j0 = H, j1 = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const i = p % W, j = (p - i) / W;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (i > 0 && land[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (i < W - 1 && land[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (j > 0 && land[p - W] && !label[p - W]) { label[p - W] = id; stack.push(p - W); }
      if (j < H - 1 && land[p + W] && !label[p + W]) { label[p + W] = id; stack.push(p + W); }
    }
    comps.push({ id, n, i0, i1, j0, j1 });
  }
}
// Outer boundary of one component as a ring of world points (cell-corner walk, then edge midpoints)
function traceComponent(c) {
  const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
  const at = (i, j) => (i >= 0 && j >= 0 && i < w && j < h && label[(c.j0 + j) * W + c.i0 + i] === c.id ? 1 : 0);
  let si = -1, sj = -1;
  outer: for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (at(i, j)) { si = i; sj = j; break outer; }
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  let cx = si, cz = sj, dir = 0;
  const pts = [];
  const start = `${cx},${cz},${dir}`;
  let guard = 0;
  do {
    pts.push([cx, cz]);
    cx += DX[dir];
    cz += DZ[dir];
    let left, right;
    if (dir === 0) { left = at(cx, cz - 1); right = at(cx, cz); }
    else if (dir === 1) { left = at(cx, cz); right = at(cx - 1, cz); }
    else if (dir === 2) { left = at(cx - 1, cz); right = at(cx - 1, cz - 1); }
    else { left = at(cx - 1, cz - 1); right = at(cx, cz - 1); }
    if (left && right) dir = (dir + 3) % 4;
    else if (!left && right) { /* straight */ }
    else dir = (dir + 1) % 4;
    if (++guard > 5000000) throw new Error('trace runaway');
  } while (`${cx},${cz},${dir}` !== start);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
    if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
  }
  return out.map((q, i) => {
    const n = out[(i + 1) % out.length];
    return [X0 + (c.i0 + (q[0] + n[0]) / 2) * RES, Z0 + (c.j0 + (q[1] + n[1]) / 2) * RES];
  });
}

// Buildings -> lots (oriented rectangles in the frame of their longest wall)
const osmBuildings = load('osm_buildings.json');
const lotsByComp = new Map();
let nLots = 0;
for (const e of osmBuildings) {
  const t = e.tags || {};
  for (const ring of outerRings(e)) {
    if (!closedRing(ring)) continue;
    const r = rdpRing(ring.slice(0, -1), 0.4);
    if (r.length < 3) continue;
    const area = Math.abs(ringArea(r));
    if (area < 20) continue;
    const [cx, cz] = centroid(r);
    const ci = Math.floor((cx - X0) / RES), cj = Math.floor((cz - Z0) / RES);
    if (ci < 0 || cj < 0 || ci >= W || cj >= H) continue;
    let comp = label[cj * W + ci];
    if (!comp) {
      // centroid fell on a roadway/water cell: look at the 5x5 neighbourhood
      for (let dj = -2; dj <= 2 && !comp; dj++) for (let di = -2; di <= 2 && !comp; di++) {
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < W && j < H) comp = label[j * W + i];
      }
    }
    if (!comp) continue;
    // Orientation: angle of the longest edge, folded into [0, π/2)
    let best = 0, ang = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const L = Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
      if (L > best) { best = L; ang = Math.atan2(r[i][1] - r[j][1], r[i][0] - r[j][0]); }
    }
    ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (ang > Math.PI / 4) ang -= Math.PI / 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of r) {
      const u = (x - cx) * c + (z - cz) * s;
      const v = -(x - cx) * s + (z - cz) * c;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const lvl = parseFloat(t['building:levels']);
    const h = t.height ? parseFloat(t.height) : Number.isFinite(lvl) ? lvl * 3.2 : 0;
    const hh = Number.isFinite(h) ? Math.round(h * 10) / 10 : 0;
    if (!lotsByComp.has(comp)) lotsByComp.set(comp, []);
    const lots = lotsByComp.get(comp);
    const angR = Math.round(ang * 1e4) / 1e4;
    // A lot from its extents in the building's frame (about the ring's centroid): centred on the rectangle itself
    const push = (ua, ub, va, vb) => {
      if (ub - ua < 2.5 || vb - va < 2.5) return;
      const mu = (ua + ub) / 2, mv = (va + vb) / 2;
      lots.push({ ang: angR, cx: cx + mu * c - mv * s, cz: cz + mu * s + mv * c, w: ub - ua, d: vb - va, h: hh });
      nLots++;
    };
    // Courtyard buildings (multipolygons with an inner ring) become four wings around the patio
    let patio = null;
    if (e.type === 'relation' && (u1 - u0) * (v1 - v0) > 400) {
      for (const inner of outerRings(e, 'inner')) {
        if (!closedRing(inner) || Math.abs(ringArea(inner)) < 60) continue;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, z] of inner) {
          const u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c;
          a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v);
        }
        if (a0 > u0 && a1 < u1 && b0 > v0 && b1 < v1 && (!patio || (a1 - a0) * (b1 - b0) > (patio.u1 - patio.u0) * (patio.v1 - patio.v0))) patio = { u0: a0, u1: a1, v0: b0, v1: b1 };
      }
    }
    if (patio) {
      push(u0, u1, v0, patio.v0);
      push(u0, u1, patio.v1, v1);
      push(u0, patio.u0, patio.v0, patio.v1);
      push(patio.u1, u1, patio.v0, patio.v1);
    } else {
      push(u0, u1, v0, v1);
    }
  }
}
log(`${nLots} building lots`);

const inPark = (x, z) => {
  for (const p of parkRings) {
    const bb = p.bb || (p.bb = bbox(p.ring));
    if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
    let inside = false;
    for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) {
      const [xi, zi] = p.ring[i], [xj, zj] = p.ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return p;
  }
  return null;
};

const blocks = [];
for (const c of comps) {
  const area = c.n * RES * RES;
  if (area < 150 || c.n > (W * H) / 3) continue;
  const ring = rdpRing(traceComponent(c), 1.0);
  if (ring.length < 3) continue;
  if (ringArea(ring) > 0) ring.reverse(); // same winding as the NYC blocks (negative shoelace area in x, z)
  const [cx, cz] = centroid(ring);
  const park = inPark(cx, cz);
  const lots = lotsByComp.get(c.id) || [];
  const frames = lots.map((l) => [l.ang, l.cx, l.cz, [[l.cx - l.w / 2, l.cx + l.w / 2, l.cz - l.d / 2, l.cz + l.d / 2]], l.h]);
  blocks.push([
    flat(ring), [], park ? 1 : 0, park ? park.name : '', 0,
    frames.length ? frames.map(([th, px, pz, rs, h]) => [th, r1(px), r1(pz), rs.map((r) => r.map(r1)), h]) : 0
  ]);
}
log(`${blocks.length} blocks`);

// =====================================================================================================================
// 6. LANDMARKS: named footprints
// =====================================================================================================================
const landmarks = {};
for (const e of load('osm_landmarks.json')) {
  const t = e.tags || {};
  if (!t.name || e.type === 'node') continue;
  if (!(t.building || t.tourism || t.amenity === 'place_of_worship')) continue;
  const rings = outerRings(e).filter(closedRing);
  if (!rings.length) continue;
  const r = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
  const bb = bbox(r);
  const area = Math.abs(ringArea(r));
  const prev = landmarks[t.name];
  if (prev && prev.area >= area) continue;
  const rr = rdpRing(r.slice(0, -1), 0.4);
  // Orientation: angle of the longest wall, folded into (-45°, 45°]; the footprint's size in that frame
  let best = 0, ang = 0;
  for (let i = 0, j = rr.length - 1; i < rr.length; j = i++) {
    const L = Math.hypot(rr[i][0] - rr[j][0], rr[i][1] - rr[j][1]);
    if (L > best) { best = L; ang = Math.atan2(rr[i][1] - rr[j][1], rr[i][0] - rr[j][0]); }
  }
  ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  if (ang > Math.PI / 4) ang -= Math.PI / 2;
  const [mx, mz] = centroid(rr);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of rr) {
    const u = (x - mx) * Math.cos(ang) + (z - mz) * Math.sin(ang);
    const v = -(x - mx) * Math.sin(ang) + (z - mz) * Math.cos(ang);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const worship = t.amenity === 'place_of_worship' || /iglesia|catedral|bas[ií]lica|sagrario|capilla|monasterio|santuario/i.test(t.name) ? 1 : 0;
  landmarks[t.name] = {
    x: r1((bb.x0 + bb.x1) / 2), z: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0),
    h: t.height ? parseFloat(t.height) : null, area: Math.round(area), ring: flat(rr),
    ang: Math.round(ang * 1e4) / 1e4, ow: r1(u1 - u0), od: r1(v1 - v0), cx: r1(mx + ((u0 + u1) / 2) * Math.cos(ang) - ((v0 + v1) / 2) * Math.sin(ang)), cz: r1(mz + ((u0 + u1) / 2) * Math.sin(ang) + ((v0 + v1) / 2) * Math.cos(ang)), worship
  };
}
log(`${Object.keys(landmarks).length} named footprints`);

// The cathedral's mapped parts: its two bell towers and three blue domes
if (fs.existsSync(path.join(DATA, 'osm_cathedral.json')) && landmarks['Catedral de la Inmaculada Concepción']) {
  const parts = [];
  for (const e of load('osm_cathedral.json')) {
    const r = geom(e);
    if (r.length < 3) continue;
    const bb = bbox(r);
    parts.push({ kind: e.tags['building:part'] ? 'dome' : 'tower', x: r1((bb.x0 + bb.x1) / 2), z: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0), area: Math.round(Math.abs(ringArea(r))) });
  }
  landmarks['Catedral de la Inmaculada Concepción'].parts = parts;
  log(`cathedral parts: ${parts.map((p) => `${p.kind} ${p.area} m2`).join(', ')}`);
}

// =====================================================================================================================
// 7. TERRAIN: SRTM elevations (tools/fetch-cuenca-elevation.mjs), relative to the origin and lightly smoothed
// =====================================================================================================================
let terrain = null;
if (fs.existsSync(path.join(DATA, 'elevation.json'))) {
  const el = JSON.parse(fs.readFileSync(path.join(DATA, 'elevation.json'), 'utf8'));
  let h = Float64Array.from(el.elev);
  // SRTM is a surface model (roofs and tree canopy included): two passes of a 3x3 binomial filter
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(h.length);
    for (let j = 0; j < el.nz; j++) {
      for (let i = 0; i < el.nx; i++) {
        let sum = 0, wsum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = Math.min(el.nx - 1, Math.max(0, i + di)), jj = Math.min(el.nz - 1, Math.max(0, j + dj));
          const wgt = (di ? 1 : 2) * (dj ? 1 : 2);
          sum += h[jj * el.nx + ii] * wgt;
          wsum += wgt;
        }
        out[j * el.nx + i] = sum / wsum;
      }
    }
    h = out;
  }
  // height of the origin (bilinear)
  const fx = (0 - el.x0) / el.step, fz = (0 - el.z0) / el.step;
  const i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
  const at = (i, j) => h[j * el.nx + i];
  const base = at(i0, j0) * (1 - tx) * (1 - tz) + at(i0 + 1, j0) * tx * (1 - tz) + at(i0, j0 + 1) * (1 - tx) * tz + at(i0 + 1, j0 + 1) * tx * tz;
  terrain = { x0: el.x0, z0: el.z0, step: el.step, nx: el.nx, nz: el.nz, baseElevation: Math.round(base), h: Array.from(h, (v) => r1(v - base)) };
  log(`terrain ${el.nx} x ${el.nz}, origin at ${Math.round(base)} m, relief ${Math.min(...terrain.h)} .. ${Math.max(...terrain.h)} m`);
}

// =====================================================================================================================
// 8. ASSEMBLE
// =====================================================================================================================
const GEO = {
  version: 1,
  frame: { bearingDeg: Math.round(((THETA * 180) / Math.PI) * 1000) / 1000, origin: 'Parque Calderón (Cuenca, Ecuador)', units: 'm', lat0: LAT0, lon0: LON0, bounds: { minX: r1(wb.x0), maxX: r1(wb.x1), minZ: r1(wb.z0), maxZ: r1(wb.z1) } },
  roads: roads.filter((r) => !/^(track|rest_area)$/.test(r.e.tags.highway)).map((r) => [r.name, r1(r.w), r.dir ? String(r.dir) : '', r.lanes, r.hw, flat(r.pts)]),
  roadGraph: { nodes: gNodes, links: gLinks, names: gNames },
  terrain,
  rivers,
  water,
  blocks,
  parks,
  landmarks
};
const header = `// js/cuenca-geodata.js — GENERATED by tools/build-cuenca-geodata.mjs, do not edit by hand.
// Real Cuenca (Ecuador) geography in the simulation's world frame: 1 unit = 1 m, x = grid east, z = grid south,
// origin at Parque Calderón, axes turned ${GEO.frame.bearingDeg}° from true north.
// Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays.
// Block lot frames: [θ, px, pz, [[x0, x1, z0, z1]], height m (0 = unknown)].
// Source: © OpenStreetMap contributors (ODbL).
`;
fs.writeFileSync(OUT, `${header}export const GEO = ${JSON.stringify(GEO)};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
