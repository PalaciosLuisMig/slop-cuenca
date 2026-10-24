import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './cuenca-geodata.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { groundHeightAt, terrainHeightAt } from './city-config.js';

// js/cuenca-traffic.js
// Ambient life for Cuenca on the street centreline graph (GEO.roadGraph): cars and buses that follow the streets on the
// right-hand side, and pedestrians who walk the sidewalks. Only the vehicles and people near the camera are simulated:
// the ones left behind are moved to a street near it, so a few hundred of them keep any neighbourhood busy.

const CAR_COUNT = 120;
const BUS_COUNT = 10;
const PED_COUNT = 150;
const SPAWN_MIN = 120; // spawn ring around the camera (m)
const SPAWN_MAX = 520;
const DESPAWN = 640;
const PED_SPAWN_MAX = 240;
const PED_DESPAWN = 320;
const SIDEWALK_Y = 0.22;
const CELL = 160;

const rand = (() => {
  let a = 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

// ---------------------------------------------------------------------------------------------------------------------
// Street graph
// ---------------------------------------------------------------------------------------------------------------------
function buildGraph() {
  const { nodes, links } = GEO.roadGraph;
  const nodePos = [];
  for (let i = 0; i < nodes.length; i += 2) nodePos.push([nodes[i], nodes[i + 1]]);
  const out = [];
  const exits = nodePos.map(() => []); // per node: { link, fwd } leaving it
  links.forEach(([a, b, , w, lanes, dir, inner]) => {
    const pts = [nodePos[a]];
    for (let i = 0; i < inner.length; i += 2) pts.push([inner[i], inner[i + 1]]);
    pts.push(nodePos[b]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1];
    if (len < 3 || w < 4) return;
    const link = { id: out.length, a, b, w, lanes, dir, pts, cum, len };
    out.push(link);
    if (dir >= 0) exits[a].push({ link, fwd: true });
    if (dir <= 0) exits[b].push({ link, fwd: false });
  });
  // Spatial index of the links by their points (for spawning near the camera)
  const cells = new Map();
  for (const link of out) {
    const seen = new Set();
    for (let i = 0; i < link.pts.length; i++) {
      const k = `${Math.floor(link.pts[i][0] / CELL)},${Math.floor(link.pts[i][1] / CELL)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(link);
    }
  }
  return { links: out, exits, cells, nodePos };
}

// Position and unit direction at distance s along a link, in the direction of travel
const _p = { x: 0, z: 0, dx: 0, dz: 1 };
function sample(link, fwd, s) {
  const d = fwd ? s : link.len - s;
  const cum = link.cum;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  const a = link.pts[i - 1], b = link.pts[i];
  let dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  dx /= L; dz /= L;
  if (!fwd) { dx = -dx; dz = -dz; }
  _p.x = a[0] + (b[0] - a[0]) * Math.max(0, Math.min(1, t));
  _p.z = a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t));
  _p.dx = dx;
  _p.dz = dz;
  return _p;
}

// ---------------------------------------------------------------------------------------------------------------------
// Models: one merged, vertex-coloured mesh per kind, tinted per instance
// ---------------------------------------------------------------------------------------------------------------------
function coloured(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}
const box = (w, h, d, x, y, z, rgb, taperTop = 1, taperZ = 1) => {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) * taperTop); p.setZ(i, p.getZ(i) * taperZ); }
  }
  g.translate(x, y, z);
  return coloured(g, ...rgb);
};
function wheel(x, z, r = 0.34) {
  const g = new THREE.CylinderGeometry(r, r, 0.24, 14).toNonIndexed();
  g.rotateZ(Math.PI / 2);
  g.translate(x, r, z);
  return coloured(g, 0.04, 0.04, 0.045);
}
function carGeometry() {
  const parts = [
    box(1.82, 0.62, 4.35, 0, 0.66, 0, [1, 1, 1]),
    box(1.6, 0.56, 2.25, 0, 1.25, -0.2, [0.07, 0.09, 0.12], 0.86, 0.72), // cabin glass (tapered roof)
    box(1.5, 0.05, 1.5, 0, 1.54, -0.2, [1, 1, 1]), // roof panel in body colour
    box(1.74, 0.1, 0.12, 0, 0.78, 2.19, [1, 0.95, 0.75]), // headlights
    box(1.74, 0.1, 0.12, 0, 0.78, -2.19, [0.9, 0.05, 0.05]), // tail lights
    wheel(-0.86, 1.3), wheel(0.86, 1.3), wheel(-0.86, -1.3), wheel(0.86, -1.3)
  ];
  const g = mergeGeometries(parts);
  return g;
}
function busGeometry() {
  const parts = [
    box(2.5, 2.7, 11, 0, 1.75, 0, [1, 1, 1]),
    box(2.52, 0.95, 9.6, 0, 2.25, 0, [0.07, 0.09, 0.12]), // window band
    box(2.3, 0.3, 0.15, 0, 0.9, 5.52, [1, 0.95, 0.75]),
    box(2.3, 0.3, 0.15, 0, 0.9, -5.52, [0.9, 0.05, 0.05]),
    wheel(-1.1, 3.4, 0.5), wheel(1.1, 3.4, 0.5), wheel(-1.1, -3.2, 0.5), wheel(1.1, -3.2, 0.5)
  ];
  return mergeGeometries(parts);
}
const CAR_COLOURS = [0xf2c200, 0xf2c200, 0xf2c200, 0xf5f5f2, 0xf5f5f2, 0xc9ccd1, 0x34383f, 0x8a1f1f, 0x1f3f7a, 0x2d5a3a, 0xb8b8b0, 0x15171a];
const BUS_COLOURS = [0xe6e6e0, 0xd8cdb0, 0xa6d1e6];

// ---------------------------------------------------------------------------------------------------------------------
function createCuencaTraffic(scene) {
  const graph = buildGraph();
  const group = new THREE.Group();
  group.name = 'CuencaTraffic';

  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.35, roughness: 0.38, vertexColors: true });
  const carMesh = new THREE.InstancedMesh(carGeometry(), mat, CAR_COUNT);
  const busMesh = new THREE.InstancedMesh(busGeometry(), mat, BUS_COUNT);
  for (const [m, name] of [[carMesh, 'Cars'], [busMesh, 'Buses']]) {
    m.name = name;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }
  const tint = new THREE.Color();
  const dummy = new THREE.Object3D();

  const vehicles = [];
  const makeVehicle = (bus, index) => {
    const v = {
      bus, index, link: null, fwd: true, s: 0, speed: 0, acc: 0, x: 0, z: 0, yaw: 0, yawOffset: 0, lane: 1.8, vFree: 9,
      wait: 0, gap: 99, leaderSpeed: 99, conn: null, yielding: false, isSUV: !bus && rand() < 0.25, isPolice: false,
      driver: { a: 1.3 + rand() * 0.6 }, edge: { to: { signal: false }, axisIndex: 0 }, active: false
    };
    tint.setHex((bus ? BUS_COLOURS : CAR_COLOURS)[Math.floor(rand() * (bus ? BUS_COLOURS.length : CAR_COLOURS.length))]);
    (bus ? busMesh : carMesh).setColorAt(index, tint);
    vehicles.push(v);
    return v;
  };
  const cars = [];
  const buses = [];
  for (let i = 0; i < CAR_COUNT; i++) cars.push(makeVehicle(false, i));
  for (let i = 0; i < BUS_COUNT; i++) buses.push(makeVehicle(true, i));

  function randomLinkNear(cx, cz, rMin, rMax, minWidth, tries = 24) {
    for (let t = 0; t < tries; t++) {
      const ang = rand() * Math.PI * 2;
      const r = rMin + rand() * (rMax - rMin);
      const list = graph.cells.get(`${Math.floor((cx + Math.cos(ang) * r) / CELL)},${Math.floor((cz + Math.sin(ang) * r) / CELL)}`);
      if (!list) continue;
      const link = list[Math.floor(rand() * list.length)];
      if (link.w >= minWidth) return link;
    }
    return null;
  }

  function place(v, camX, camZ) {
    const link = randomLinkNear(camX, camZ, SPAWN_MIN, SPAWN_MAX, v.bus ? 9 : 5);
    if (!link) { v.active = false; return; }
    v.link = link;
    v.fwd = link.dir === 0 ? rand() < 0.5 : link.dir > 0;
    v.s = rand() * link.len;
    v.speed = 0;
    v.wait = 0;
    v.lane = link.dir === 0 ? Math.min(3.2, Math.max(1.3, link.w * 0.25)) : Math.min(2.2, Math.max(0, link.w * 0.18));
    v.vFree = (link.w >= 12 ? 12.5 : link.w >= 9 ? 10.5 : 8) * (0.85 + rand() * 0.3) * (v.bus ? 0.85 : 1);
    v.active = true;
    const p = sample(link, v.fwd, v.s);
    v.x = p.x - p.dz * v.lane;
    v.z = p.z + p.dx * v.lane;
    v.yaw = Math.atan2(p.dx, p.dz);
  }

  function advance(v, dt, speedCap) {
    const link = v.link;
    // accelerate to the free speed, or to the cap set by the vehicle ahead
    const target = Math.min(v.vFree, speedCap);
    const prev = v.speed;
    v.speed += Math.max(-9 * dt, Math.min(2.2 * dt, target - v.speed));
    v.acc = (v.speed - prev) / Math.max(dt, 1e-3);
    v.s += v.speed * dt;
    if (v.s >= link.len) {
      // at the end of the link: continue onto a street leaving the node (never straight back unless it is a dead end)
      const node = v.fwd ? link.b : link.a;
      const options = graph.exits[node].filter((e) => e.link !== link);
      let next = options.length ? options[Math.floor(rand() * options.length)] : null;
      if (!next) next = graph.exits[node].find((e) => e.link === link && e.fwd !== v.fwd) || { link, fwd: !v.fwd };
      const over = v.s - link.len;
      v.link = next.link;
      v.fwd = next.fwd;
      v.s = Math.min(over, v.link.len);
      v.lane = v.link.dir === 0 ? Math.min(3.2, Math.max(1.3, v.link.w * 0.25)) : Math.min(2.2, Math.max(0, v.link.w * 0.18));
      v.vFree = (v.link.w >= 12 ? 12.5 : v.link.w >= 9 ? 10.5 : 8) * (0.85 + rand() * 0.3) * (v.bus ? 0.85 : 1);
    }
    const p = sample(v.link, v.fwd, v.s);
    const tx = p.x - p.dz * v.lane, tz = p.z + p.dx * v.lane;
    // body follows the lane smoothly
    const k = Math.min(1, dt * 8);
    v.x += (tx - v.x) * k;
    v.z += (tz - v.z) * k;
    const yaw = Math.atan2(p.dx, p.dz);
    let dy = yaw - v.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    v.yaw += dy * Math.min(1, dt * 6);
  }

  // ---- Pedestrians -------------------------------------------------------------------------------------------------
  const crowd = new PersonCrowd(PED_COUNT, { farDistance: 34, castShadow: true });
  for (const m of crowd.meshes) group.add(m);
  const peds = [];
  const groundFn = (owner, x, z) => groundHeightAt(x, z, 'person');
  for (let i = 0; i < PED_COUNT; i++) {
    const female = rand() < 0.5;
    const rig = new PersonRig({ seed: Math.floor(rand() * 200), scale: 0.93 + rand() * 0.14, female, girth: 0.92 + rand() * 0.2, hair: rand(), armSwing: 0.8 + rand() * 0.4, stride: 0.9 + rand() * 0.2 });
    peds.push({ rig, placed: false, link: null, fwd: true, s: 0, side: 1, v: 0, vWalk: 1.1 + rand() * 0.5, x: 0, z: 0, ax: 0, az: 0, ux: 0, uz: 1, len: 1, node: null, heading: 0, wait: 0 });
  }
  function placePed(p, camX, camZ) {
    const link = randomLinkNear(camX, camZ, 15, PED_SPAWN_MAX, 5, 30);
    if (!link) { p.placed = false; return; }
    p.link = link;
    p.fwd = rand() < 0.5;
    p.s = rand() * link.len;
    p.side = rand() < 0.5 ? 1 : -1;
    p.placed = true;
    p.v = p.vWalk;
    const q = sample(link, p.fwd, p.s);
    const off = p.side * (link.w / 2 + 1.6);
    p.x = q.x - q.dz * off;
    p.z = q.z + q.dx * off;
    p.heading = Math.atan2(q.dx, q.dz);
    p.rig.reset(p.x, p.z, p.heading, groundFn, null);
  }
  function stepPed(p, dt) {
    const link = p.link;
    p.s += p.v * dt;
    if (p.s >= link.len) {
      const node = p.fwd ? link.b : link.a;
      const all = graph.exits[node];
      // walking is not one-way: any street at the node, found through its exits (both directions are walkable)
      const options = all.filter((e) => e.link !== link);
      const next = options.length ? options[Math.floor(rand() * options.length)] : { link, fwd: !p.fwd };
      const over = p.s - link.len;
      p.link = next.link;
      p.fwd = next.fwd;
      p.s = Math.min(over, p.link.len);
    }
    const q = sample(p.link, p.fwd, p.s);
    const off = p.side * (p.link.w / 2 + 1.6);
    const tx = q.x - q.dz * off, tz = q.z + q.dx * off;
    p.heading = Math.atan2(tx - p.x, tz - p.z);
    p.x = tx;
    p.z = tz;
    p.ax = p.x; p.az = p.z;
    const hd = Math.atan2(q.dx, q.dz);
    p.ux = Math.sin(hd); p.uz = Math.cos(hd);
    p.len = 1e9; // (the audio only checks crossings; there are none here)
  }

  // ---- Frame update ------------------------------------------------------------------------------------------------
  const _m = new THREE.Matrix4();
  let firstFrame = true;
  function update(dt, elapsed, cameraPos, activeEntity /* , mode, camera */) {
    dt = Math.min(dt, 0.05);
    const cx = cameraPos.x, cz = cameraPos.z;
    const px = activeEntity ? activeEntity.position.x : cx;
    const pz = activeEntity ? activeEntity.position.z : cz;

    for (const v of vehicles) {
      if (!v.active || (firstFrame ? false : Math.hypot(v.x - cx, v.z - cz) > DESPAWN)) place(v, cx, cz);
    }
    // Following: cap the speed behind the car ahead on the same street, and behind the player
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.active) continue;
      let cap = 99;
      let gap = 99;
      let leader = 99;
      const hx = Math.sin(v.yaw), hz = Math.cos(v.yaw);
      for (let j = 0; j < vehicles.length; j++) {
        if (i === j) continue;
        const o = vehicles[j];
        if (!o.active) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        const ahead = dx * hx + dz * hz;
        if (ahead < 0.5 || ahead > 24) continue;
        const side = Math.abs(dx * hz - dz * hx);
        if (side > 1.9) continue;
        if (ahead < gap) { gap = ahead; leader = o.speed; }
      }
      {
        const dx = px - v.x, dz = pz - v.z;
        const ahead = dx * hx + dz * hz;
        if (ahead > 0.5 && ahead < 24 && Math.abs(dx * hz - dz * hx) < 2.4 && ahead < gap) { gap = ahead; leader = 0; }
      }
      if (gap < 24) cap = Math.max(0, ((gap - (v.bus ? 8 : 5.5)) / 1.4));
      v.gap = gap;
      v.leaderSpeed = leader;
      v.wait = cap < 0.5 ? v.wait + dt : 0;
      // after a long wait (a gridlock at a junction) the car edges on regardless
      advance(v, dt, v.wait > 7 ? 2 : cap);
    }
    for (const v of vehicles) {
      if (!v.active) continue;
      dummy.position.set(v.x, terrainHeightAt(v.x, v.z) + 0.03, v.z);
      dummy.rotation.set(0, v.yaw, 0);
      dummy.updateMatrix();
      (v.bus ? busMesh : carMesh).setMatrixAt(v.index, dummy.matrix);
    }
    for (const m of [carMesh, busMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // inactive instances are drawn nowhere
    for (const v of vehicles) if (!v.active) (v.bus ? busMesh : carMesh).setMatrixAt(v.index, _m.makeScale(0, 0, 0));

    // Pedestrians
    crowd.begin();
    for (const p of peds) {
      if (!p.placed || Math.hypot(p.x - cx, p.z - cz) > PED_DESPAWN) placePed(p, cx, cz);
      if (!p.placed) continue;
      const d = Math.hypot(p.x - cx, p.z - cz);
      stepPed(p, dt);
      p.rig.update(dt, p.x, p.z, p.heading, groundFn, null, 0, d < 90);
      crowd.add(p.rig, d);
    }
    crowd.end();
    firstFrame = false;
  }

  scene.add(group);
  return {
    group,
    cars,
    buses,
    peds,
    update,
    collide() {},
    setCollisionListener() {},
    network: null
  };
}

export { createCuencaTraffic };
