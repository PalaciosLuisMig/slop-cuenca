import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './cuenca-geodata.js';
import { BLOCKS, ISLAND_BOUNDS, LANDMARK_SITES, ROADS } from './city-config.js';
import {
  createCurtainWallMaterial,
  createFacadeBoxes,
  createParkLawnMaterial,
  createPreWarBuildingMaterial,
  createRoadSurfaceMaterial,
  createSidewalkMaterial
} from './tsl-materials.js';
import { createTreeField, TREE_SPECIES } from './trees.js';

// js/cuenca-city.js
// Builds Cuenca from js/cuenca-geodata.js: the roadbed, the raised sidewalk islands (blocks), the buildings on their real
// footprints with their OpenStreetMap heights, parks, rivers and trees. Everything is static, one mesh per kind.

const STOREY = 3.3;
const SIDEWALK_Y = 0.22;
const ROAD_Y = 0.03;
const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Cuenca's plaster palette: whitewash, ochre, terracotta, grey stone, with the stucco window style of the old town
const WALL_STYLES = [
  { stoneColor: 0xe9dfc8, trimColor: 0xa89a82, windowWidth: 2.2, floorHeight: STOREY, litProbability: 0.5, warmth: 0.9, seed: 11.3 },
  { stoneColor: 0xd8b98c, trimColor: 0x8d7456, windowWidth: 2.2, floorHeight: STOREY, litProbability: 0.5, warmth: 0.9, seed: 23.7 },
  { stoneColor: 0xc27a5a, trimColor: 0xd6c7ab, windowWidth: 2.4, floorHeight: STOREY, litProbability: 0.5, warmth: 0.88, seed: 35.1 },
  { stoneColor: 0xb9b2a2, trimColor: 0x7d7667, windowWidth: 2.5, floorHeight: STOREY, litProbability: 0.55, warmth: 0.8, seed: 47.9 },
  { stoneColor: 0xd9d2c0, trimColor: 0x948a76, windowWidth: 2.6, floorHeight: 3.5, litProbability: 0.55, warmth: 0.85, seed: 59.2 }
];
const STONE_MAT = new THREE.MeshStandardNodeMaterial({ color: 0xe4d9c0, metalness: 0.0, roughness: 0.85 });
const DOME_MAT = new THREE.MeshStandardNodeMaterial({ color: 0x4ba3d6, metalness: 0.15, roughness: 0.3 });
const DARK_MAT = new THREE.MeshStandardNodeMaterial({ color: 0x2a2622, metalness: 0.0, roughness: 0.6 });
const ROOF_MAT = new THREE.MeshStandardNodeMaterial({ color: 0x9c4a33, metalness: 0.0, roughness: 0.82 });
const GLASS_STYLE = { glassTint: 0x1a3a52, frameTint: 0x3b4c5b, windowWidth: 2.7, floorHeight: 3.6, litProbability: 0.6, warmth: 0.55, reflectivity: 0.9, seed: 63.5 };


// Catedral de la Inmaculada Concepción (the "new" cathedral): a stone body under a large sky-blue and white central dome,
// two smaller domes and two unfinished towers on the park front. `lot` is the footprint box in world space.
const CATHEDRAL_NAME = 'Catedral de la Inmaculada Concepción';
const NAVE_H = 27;
function addCathedral(group, boxes, lot) {
  const { px, pz, w, d, ang } = lot;
  const c = Math.cos(ang), s = Math.sin(ang);
  // local (u along the long wall, v across it) -> world
  const at = (u, v) => [px + u * c - v * s, pz + u * s + v * c];
  // the façade looks at Parque Calderón: north, towards -z
  const towerU = w / 2 - 8.5;
  const towerV = -(d / 2 - 7.5);
  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = -ang;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // nave
  mesh(new THREE.BoxGeometry(w, NAVE_H, d), STONE_MAT, px, SIDEWALK_Y + NAVE_H / 2, pz);
  // towers on the park front, each with a stepped cap
  for (const sign of [-1, 1]) {
    const [x, z] = at(sign * towerU, towerV);
    mesh(new THREE.BoxGeometry(14, 44, 14), STONE_MAT, x, SIDEWALK_Y + 22, z);
    mesh(new THREE.BoxGeometry(11, 2.4, 11), STONE_MAT, x, SIDEWALK_Y + 45.2, z);
    mesh(new THREE.BoxGeometry(6, 5, 6), DOME_MAT, x, SIDEWALK_Y + 48.9, z);
    // belfry openings on the four faces of the tower
    for (const [lu, lv] of [[0, -7.05], [0, 7.05], [-7.05, 0], [7.05, 0]]) {
      const [wx, wz] = at(sign * towerU + lu, towerV + lv);
      const o = mesh(new THREE.BoxGeometry(lu ? 0.2 : 2.6, 6, lu ? 2.6 : 0.2), DARK_MAT, wx, SIDEWALK_Y + 36, wz);
      o.castShadow = false;
    }
  }
  // façade: three arched doors and a rose window facing the park, then tall arched windows along both flanks
  for (const u of [-w * 0.12, 0, w * 0.12]) {
    const [x, z] = at(u, -d / 2 - 0.08);
    const door = mesh(new THREE.BoxGeometry(5.4, 9, 0.3), DARK_MAT, x, SIDEWALK_Y + 4.5, z);
    door.castShadow = false;
  }
  {
    const [x, z] = at(0, -d / 2 - 0.1);
    const rose = mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.3, 24), DARK_MAT, x, SIDEWALK_Y + 17, z);
    rose.rotation.order = 'YXZ';
    rose.rotation.set(Math.PI / 2, -ang, 0);
    rose.castShadow = false;
  }
  for (const v of [-d / 2 - 0.08, d / 2 + 0.08]) {
    for (let u = -w / 2 + 18; u <= w / 2 - 18; u += 7) {
      const [x, z] = at(u, v);
      const win = mesh(new THREE.BoxGeometry(1.5, 8, 0.25), DARK_MAT, x, SIDEWALK_Y + 15, z);
      win.castShadow = false;
    }
  }
  const base = SIDEWALK_Y + NAVE_H;
  const dome = (u, v, r, name) => {
    const [x, z] = at(u, v);
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, base, z);
    const drumH = r * 0.7;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.12, drumH, 28), STONE_MAT);
    drum.position.y = drumH / 2;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), DOME_MAT);
    shell.position.y = drumH;
    shell.scale.y = 0.9;
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.24, r * 0.5, 12), STONE_MAT);
    lantern.position.y = drumH + r * 0.9 + r * 0.25;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.24, r * 0.4, 12), DOME_MAT);
    cone.position.y = drumH + r * 0.9 + r * 0.5 + r * 0.2;
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.28, r * 0.5, 0.28), STONE_MAT);
    crossV.position.y = cone.position.y + r * 0.2 + r * 0.25;
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(r * 0.26, 0.28, 0.28), STONE_MAT);
    crossH.position.y = crossV.position.y + r * 0.08;
    g.add(drum, shell, lantern, cone, crossV, crossH);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);
  };
  dome(0, 2, 11.5, 'CathedralDome'); // the large central dome: tip ~57 m
  dome(-w * 0.27, 2, 6.2, 'CathedralDomeW');
  dome(w * 0.27, 2, 6.2, 'CathedralDomeE');
  // Gabled roof of the nave between the domes (tile red)
  for (const [u0, u1] of [[-w / 2 + 14, -w * 0.27 - 8], [w * 0.27 + 8, w / 2 - 14]]) {
    const len = u1 - u0;
    if (len < 6) continue;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), ROOF_MAT);
    roof.geometry.rotateY(Math.PI / 4);
    roof.geometry.translate(0, 0.5, 0);
    const [x, z] = at((u0 + u1) / 2, 2);
    roof.position.set(x, base, z);
    roof.scale.set(len, 5, d * 0.72);
    roof.rotation.y = -ang;
    roof.castShadow = true;
    group.add(roof);
  }
}

function stripGeometry(pts, width, y, extend = 0.15) {
  const pos = [];
  const idx = [];
  const hw = width / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const nx = -uz * hw, nz = ux * hw;
    const x0 = ax - ux * extend, z0 = az - uz * extend, x1 = bx + ux * extend, z1 = bz + uz * extend;
    const base = pos.length / 3;
    pos.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flatShape(flat, y) {
  const shape = new THREE.Shape();
  for (let i = 0; i < flat.length; i += 2) {
    if (i === 0) shape.moveTo(flat[i], -flat[i + 1]);
    else shape.lineTo(flat[i], -flat[i + 1]);
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function slabGeometry(poly, height) {
  const shape = new THREE.Shape();
  poly.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function buildCuencaCity(scene) {
  const group = new THREE.Group();
  group.name = 'CuencaCity';
  const colliders = [];

  // ---- Ground beyond the city & the roadbed ---------------------------------------------------------------------------
  const far = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2), createParkLawnMaterial(true));
  far.position.set((ISLAND_BOUNDS.minX + ISLAND_BOUNDS.maxX) / 2, -0.3, (ISLAND_BOUNDS.minZ + ISLAND_BOUNDS.maxZ) / 2);
  far.receiveShadow = true;
  far.name = 'CuencaGround';
  group.add(far);

  // ---- Roads: asphalt ribbons ------------------------------------------------------------------------------------------
  const roadMat = createRoadSurfaceMaterial();
  const roadGeos = [];
  for (const r of ROADS) {
    if (r.w <= 0) continue;
    const pts = r.pts.map((p) => [p.x, p.z]);
    // pedestrian streets & tracks are lighter-weight: narrower ribbons, same material
    const g = stripGeometry(pts, r.w + 1.2, ROAD_Y);
    if (g) roadGeos.push(g);
  }
  // Chunk the roads so frustum culling can reject far ones: 1 km tiles
  const TILE = 1000;
  const tiles = new Map();
  for (const g of roadGeos) {
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    const key = `${Math.floor(c.x / TILE)},${Math.floor(c.z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(g);
  }
  for (const [key, list] of tiles) {
    const m = new THREE.Mesh(mergeGeometries(list), roadMat);
    m.name = `Roads_${key}`;
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- Rivers & water --------------------------------------------------------------------------------------------------
  const waterMat = new THREE.MeshStandardNodeMaterial({ color: 0x3f6f7d, metalness: 0.1, roughness: 0.12 });
  const waterGeos = [];
  for (const rv of GEO.rivers) {
    const pts = [];
    for (let i = 0; i < rv.pts.length; i += 2) pts.push([rv.pts[i], rv.pts[i + 1]]);
    const g = stripGeometry(pts, Math.max(rv.w, 6), 0.012);
    if (g) waterGeos.push(g);
  }
  for (const w of GEO.water) {
    try { waterGeos.push(flatShape(w.ring, 0.012)); } catch { /* degenerate ring */ }
  }
  if (waterGeos.length) {
    const water = new THREE.Mesh(mergeGeometries(waterGeos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      g.deleteAttribute('uv');
      return g;
    })), waterMat);
    water.name = 'CuencaWater';
    water.receiveShadow = true;
    group.add(water);
  }

  // ---- Blocks: sidewalk islands, parks, buildings ----------------------------------------------------------------------
  const sidewalkMat = createSidewalkMaterial();
  const lawnMat = createParkLawnMaterial(false);
  const slabGeos = [];
  const lawnGeos = [];
  const boxes = [[], [], [], [], [], []]; // one list per facade style (the last: glass)
  const roofs = [];
  const treeSites = [];
  const worship = Object.entries(LANDMARK_SITES).filter(([, l]) => l.worship && l.ring).map(([name, l]) => ({ name, poly: pairs(l.ring), cx: l.cx, cz: l.cz }));
  const inWorship = (x, z) => worship.find((wp) => Math.abs(x - wp.cx) < 120 && Math.abs(z - wp.cz) < 120 && pointInPoly(wp.poly, x, z));

  for (const b of BLOCKS) {
    if (b.poly.length < 3) continue;
    // Parks and big open blocks (hills, farmland, the airport...) are lawn; the rest is raised sidewalk
    const lots = b.frames || [];
    const built = lots.reduce((a, f) => a + (f[3][0][1] - f[3][0][0]) * (f[3][0][3] - f[3][0][2]), 0);
    const open = b.park > 0.5 || (b.area > 30000 && built / b.area < 0.12);
    try {
      if (open) {
        const g = slabGeometry(b.poly, 0.06);
        lawnGeos.push(g);
      } else {
        slabGeos.push(slabGeometry(b.poly, SIDEWALK_Y));
      }
    } catch { /* degenerate outline */ }

    if (open) {
      // Trees on parkland: about one per 260 m2
      const n = Math.min(60, Math.floor(b.area / 260));
      for (let i = 0; i < n; i++) {
        const x = b.minX + (b.maxX - b.minX) * hash(b.id + 1, i);
        const z = b.minZ + (b.maxZ - b.minZ) * hash(i + 3, b.id + 7);
        if (pointInPoly(b.poly, x, z)) {
          treeSites.push({ x, y: 0.06, z, scale: 0.8 + 0.5 * hash(i, b.id), species: Math.floor(hash(b.id, i + 9) * TREE_SPECIES.length) % TREE_SPECIES.length });
        }
      }
      if (!b.frames) continue;
    }

    lots.forEach(([ang, px, pz, rects, mapHeight], li) => {
      const [x0, x1, z0, z1] = rects[0];
      let w = x1 - x0, d = z1 - z0;
      if (w < 2.5 || d < 2.5) return;
      const seed = hash(b.id * 7.3 + li, px * 0.013 + pz * 0.017);
      // Real OSM height when it exists; otherwise a plausible low-rise of the old town
      let h = mapHeight > 0 ? mapHeight : 6.6 + Math.floor(seed * 3) * STOREY;
      const storeys = Math.max(1, Math.round(h / STOREY));
      h = Math.max(3.2, storeys * STOREY);
      const church = inWorship(px, pz);
      const cathedral = church && church.name === CATHEDRAL_NAME;
      if (cathedral) h = NAVE_H;
      const glass = h > 30 && seed > 0.35 && !church;
      const style = church ? 0 : glass ? 5 : Math.floor(hash(seed * 91.7, b.id) * 5) % 5;
      const c = Math.cos(ang), s = Math.sin(ang);
      if (!cathedral) boxes[style].push({ x: px, y: SIDEWALK_Y + h / 2 - 0.05, z: pz, w, h: h + 0.05, d, ry: -ang, tone: seed, faces: [1, 1, 1, 1] });
      const ex = Math.abs(c) * (w / 2) + Math.abs(s) * (d / 2);
      const ez = Math.abs(s) * (w / 2) + Math.abs(c) * (d / 2);
      colliders.push({ minX: px - ex, maxX: px + ex, minZ: pz - ez, maxZ: pz + ez, minY: 0, maxY: SIDEWALK_Y + h, obb: { cx: px, cz: pz, hx: w / 2, hz: d / 2, cs: c, sn: -s } });
      if (cathedral) addCathedral(group, boxes, { px, pz, w, d, ang });
      // Clay-tile roof on low buildings
      if (!cathedral && h < 16 && w < 34 && d < 34 && !glass) {
        roofs.push({ x: px, y: SIDEWALK_Y + h, z: pz, w: w * 1.06, d: d * 1.06, h: Math.min(w, d) * 0.22 + 0.9, ry: -ang });
      }
    });
  }

  if (slabGeos.length) {
    const slabs = new THREE.Mesh(mergeGeometries(slabGeos.map((g) => { g.deleteAttribute('uv'); return g; })), sidewalkMat);
    slabs.name = 'CuencaSidewalks';
    slabs.receiveShadow = true;
    group.add(slabs);
  }
  if (lawnGeos.length) {
    const lawns = new THREE.Mesh(mergeGeometries(lawnGeos.map((g) => { g.deleteAttribute('uv'); return g; })), lawnMat);
    lawns.name = 'CuencaLawns';
    lawns.receiveShadow = true;
    group.add(lawns);
  }

  const materials = [
    ...WALL_STYLES.map((o) => createPreWarBuildingMaterial({ ...o, boxLocal: true })),
    createCurtainWallMaterial({ ...GLASS_STYLE, boxLocal: true })
  ];
  boxes.forEach((items, i) => {
    if (!items.length) return;
    const mesh = createFacadeBoxes(materials[i], items);
    mesh.name = `CuencaBuildings_${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  if (roofs.length) {
    // Four-sided pyramid whose base is the unit square: scaled to each building's width, depth and ridge height
    const pyramid = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, false);
    pyramid.rotateY(Math.PI / 4);
    pyramid.translate(0, 0.5, 0);
    const roofMat = new THREE.MeshStandardNodeMaterial({ color: 0x9c4a33, metalness: 0.0, roughness: 0.82 });
    const mesh = new THREE.InstancedMesh(pyramid, roofMat, roofs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    roofs.forEach((r, i) => {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(r.x, r.y, r.z), q.setFromAxisAngle(up, r.ry), new THREE.Vector3(r.w, r.h, r.d)));
    });
    mesh.name = 'CuencaRoofs';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- Street trees along the sidewalk edges of the central blocks -----------------------------------------------------
  for (const b of BLOCKS) {
    if (b.area > 30000 || b.poly.length < 4) continue;
    if (Math.hypot(b.cx, b.cz) > 2200) continue;
    for (let i = 0, j = b.poly.length - 1; i < b.poly.length; j = i++) {
      const p = b.poly[j], q = b.poly[i];
      const L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L < 22) continue;
      const nx = -(q.z - p.z) / L, nz = (q.x - p.x) / L;
      for (let t = 9; t < L - 6; t += 16) {
        if (hash(b.id * 3.1 + i, t) > 0.28) continue;
        const f = t / L;
        let x = p.x + (q.x - p.x) * f + nx * 1.3, z = p.z + (q.z - p.z) * f + nz * 1.3;
        if (!pointInPoly(b.poly, x, z)) { x -= nx * 2.6; z -= nz * 2.6; }
        if (!pointInPoly(b.poly, x, z)) continue;
        treeSites.push({ x, y: SIDEWALK_Y, z, scale: 0.65 + 0.35 * hash(t, i), species: Math.floor(hash(i, t + b.id) * TREE_SPECIES.length) % TREE_SPECIES.length, tier: 1 });
      }
    }
  }
  let treeField = null;
  if (treeSites.length) {
    treeField = createTreeField(scene, treeSites.slice(0, 9000));
    group.add(treeField.group);
  }

  scene.add(group);
  return {
    group,
    colliders,
    footprints: [],
    sidewalks: [],
    treeField,
    stats: { blocks: BLOCKS.length, buildings: colliders.length, roofs: roofs.length, trees: treeSites.length }
  };
}

export { buildCuencaCity };
