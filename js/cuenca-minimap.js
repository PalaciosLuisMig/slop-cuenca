import { GEO } from './cuenca-geodata.js';
import { BLOCKS, ROADS } from './city-config.js';

// js/cuenca-minimap.js
// The radar in the bottom-left corner: Cuenca's streets, rivers and parks around the player on a canvas, north up,
// with the player's arrow pointing the way they face.

const THETA = (GEO.frame.bearingDeg * Math.PI) / 180;
const COS = Math.cos(THETA);
const SIN = Math.sin(THETA);
const RADIUS = 380; // metres from the centre of the radar to its short edge

const roadClass = (r) => (r.highway || r.w >= 12 ? 2 : r.w >= 8 ? 1 : 0);
const ROAD_STYLE = [
  { width: 1.3, color: 'rgba(170, 182, 196, 0.45)' },
  { width: 2.2, color: 'rgba(205, 214, 224, 0.75)' },
  { width: 3.4, color: 'rgba(255, 214, 120, 0.95)' }
];
const bounds = (pts) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x0, x1, z0, z1 };
};
const roads = ROADS.filter((r) => r.w > 0 && r.pts.length > 1).map((r) => ({ r, cls: roadClass(r), b: bounds(r.pts) }));
const rivers = GEO.rivers.map((rv) => {
  const pts = [];
  for (let i = 0; i < rv.pts.length; i += 2) pts.push({ x: rv.pts[i], z: rv.pts[i + 1] });
  return { pts, w: rv.w, b: bounds(pts) };
});
const lawns = BLOCKS.filter((b) => b.park > 0.5).map((b) => ({ poly: b.poly, b: { x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ } }));

function createMinimap(canvas, controllerManager) {
  if (!canvas) return { update() {} };
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, scale = 1, last = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    scale = Math.min(w, h) / 2 / RADIUS;
  }
  resize();
  window.addEventListener('resize', resize);

  // world (x, z) -> screen pixels about the player (px, pz), true north up
  const sx = (x, z, px, pz) => w / 2 + ((x - px) * COS - (z - pz) * SIN) * scale;
  const sy = (x, z, px, pz) => h / 2 + ((x - px) * SIN + (z - pz) * COS) * scale;

  function update(now) {
    if (now - last < 90) return;
    last = now;
    if (!w || !h) { resize(); if (!w) return; }
    const p = controllerManager.getActiveEntity();
    const px = p.position.x, pz = p.position.z;
    const reach = RADIUS * Math.max(w / h, 1) * 1.1;
    const near = (b) => b.x1 > px - reach && b.x0 < px + reach && b.z1 > pz - reach && b.z0 < pz + reach;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d151c';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = 'rgba(70, 120, 70, 0.55)';
    for (const l of lawns) {
      if (!near(l.b)) continue;
      ctx.beginPath();
      l.poly.forEach((q, i) => (i ? ctx.lineTo(sx(q.x, q.z, px, pz), sy(q.x, q.z, px, pz)) : ctx.moveTo(sx(q.x, q.z, px, pz), sy(q.x, q.z, px, pz))));
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(70, 140, 190, 0.85)';
    for (const rv of rivers) {
      if (!near(rv.b)) continue;
      ctx.lineWidth = Math.max(2, rv.w * scale);
      ctx.beginPath();
      rv.pts.forEach((q, i) => (i ? ctx.lineTo(sx(q.x, q.z, px, pz), sy(q.x, q.z, px, pz)) : ctx.moveTo(sx(q.x, q.z, px, pz), sy(q.x, q.z, px, pz))));
      ctx.stroke();
    }
    for (let cls = 0; cls < 3; cls++) {
      ctx.strokeStyle = ROAD_STYLE[cls].color;
      ctx.lineWidth = ROAD_STYLE[cls].width;
      ctx.beginPath();
      for (const { r, cls: c, b } of roads) {
        if (c !== cls || !near(b)) continue;
        r.pts.forEach((q, i) => (i ? ctx.lineTo(sx(q.x, q.z, px, pz), sy(q.x, q.z, px, pz)) : ctx.moveTo(sx(q.x, q.z, px, pz), sy(q.x, q.z, px, pz))));
      }
      ctx.stroke();
    }

    // The player: an arrow pointing the way they face (heading 0 faces +z, towards the south of the grid)
    const hd = p.heading;
    const dx = Math.sin(hd), dz = Math.cos(hd);
    const ax = (dx * COS - dz * SIN), ay = (dx * SIN + dz * COS);
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = '#ffd24a';
    ctx.strokeStyle = '#0a0d10';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + ax * 9, cy + ay * 9);
    ctx.lineTo(cx - ax * 6 - ay * 5.5, cy - ay * 6 + ax * 5.5);
    ctx.lineTo(cx - ax * 3, cy - ay * 3);
    ctx.lineTo(cx - ax * 6 + ay * 5.5, cy - ay * 6 - ax * 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  return { update };
}

export { createMinimap };
