import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, color, attribute, positionGeometry, positionWorld, normalGeometry,
  abs, floor, fract, mix, step, smoothstep, dot, sin, max, clamp, mx_noise_float
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// js/cuenca-facade.js
// The plastered facade of Cuenca's old town for tsl-materials.js's createFacadeBoxes() instances: lime-washed walls in the
// town's pastel palette, a darker plinth, a cornice, timber doors on the ground floor, framed windows with a wooden
// balcony on the first floor of some houses, and warm lit windows at night.
// Same instance attributes as the other facade materials: `box` = (width, height, depth, seed + 0.1..0.9 tone).

// whitewash, cream, ochre, salmon, sage, pale blue, terracotta, grey stucco
const PALETTE = [0xf0e9d8, 0xe6d6b0, 0xd9b67e, 0xd89f84, 0xbcc6a4, 0xaec8d4, 0xc9806a, 0xbfb9ac].map((c) => new THREE.Color(c));

const hash21 = (x, y) => fract(sin(x.mul(12.9898).add(y.mul(78.233))).mul(43758.5453));

function createCuencaFacadeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.9 });
  const box = attribute('box', 'vec4');
  const nG = normalGeometry;
  const nAbs = abs(nG);
  const isRoof = step(0.75, nAbs.y);
  const alongZ = step(nAbs.z, nAbs.x); // a wall facing ±x runs along z
  const wallW = mix(box.x, box.z, alongZ);
  const along = mix(positionGeometry.x, positionGeometry.z, alongZ).add(0.5);
  const tone = fract(box.w).sub(0.1).div(0.8);
  const boxSeed = floor(box.w);
  const wallSeed = floor(box.w.add(dot(nG, vec3(17.0, 0.0, 37.0))));

  const bays = max(floor(wallW.div(2.7).add(0.5)), 1.0);
  const bayW = wallW.div(bays);
  const gridU = along.mul(wallW).div(bayW);
  const bayIdx = floor(gridU);
  const bu = fract(gridU);
  const vM = positionGeometry.y.add(0.5).mul(box.y); // metres above the base of the wall
  const fromTop = box.y.sub(vM);
  const gridV = vM.div(3.3);
  const floorIdx = floor(gridV);
  const bv = fract(gridV);
  const cellKey = vec2(bayIdx.add(wallSeed), floorIdx);
  const rnd = hash21(cellKey.x, cellKey.y.add(boxSeed.mul(0.173)));

  // Wall colour from the building's tone
  let base = color(PALETTE[0]);
  for (let i = 1; i < PALETTE.length; i++) {
    base = mix(base, color(PALETTE[i]), step(i / PALETTE.length, tone));
  }
  const stucco = mx_noise_float(vec3(positionWorld.x.mul(0.9), positionWorld.y.mul(0.9), positionWorld.z.mul(0.9)));
  const coarse = mx_noise_float(vec3(positionWorld.x.mul(0.07), positionWorld.y.mul(0.2), positionWorld.z.mul(0.07)));
  const plaster = base.mul(float(1.0).add(stucco.mul(0.05)).add(coarse.mul(0.06)));

  const ground = float(1.0).sub(step(1.0, gridV));
  const wall = float(1.0).sub(isRoof);

  // Openings
  const upperWin = step(0.3, bu).mul(step(bu, 0.7)).mul(step(0.26, bv)).mul(step(bv, 0.8));
  const frame = step(0.265, bu).mul(step(bu, 0.735)).mul(step(0.225, bv)).mul(step(bv, 0.835)).sub(upperWin);
  const door = step(0.16, bu).mul(step(bu, 0.84)).mul(step(bv, 0.74)).mul(ground);
  const doorOrWindow = step(0.5, rnd); // half the ground-floor bays are windows behind an iron grille, half timber doors
  const groundWin = step(0.22, bu).mul(step(bu, 0.78)).mul(step(0.3, bv)).mul(step(bv, 0.72)).mul(ground);
  const win = mix(upperWin, groundWin, ground).mul(wall);
  const frameM = mix(frame, step(0.18, bu).mul(step(bu, 0.82)).mul(step(0.26, bv)).mul(step(bv, 0.76)).mul(ground).sub(groundWin), ground).max(0.0).mul(wall);
  const doorM = door.mul(float(1.0).sub(doorOrWindow)).mul(wall);

  // Timber balcony on the first floor of about a third of the buildings
  const hasBalcony = step(0.66, fract(boxSeed.mul(0.3719)));
  const balcony = hasBalcony.mul(step(floorIdx, 1.5)).mul(step(0.5, floorIdx)).mul(step(bv, 0.2)).mul(step(0.12, bu)).mul(step(bu, 0.88)).mul(wall);

  // Plinth, cornice and the dirt at the foot of the wall
  const plinth = smoothstep(1.1, 0.9, vM).mul(wall);
  const cornice = smoothstep(0.55, 0.35, fromTop).mul(wall);
  const corniceShadow = step(0.55, fromTop).mul(step(fromTop, 0.9)).mul(0.14).mul(wall);
  const dirt = smoothstep(2.2, 0.0, vM).mul(0.18);

  const timber = color(0x4a3220);
  const glass = color(0x25313d);
  const white = color(0xf4efe3);
  const roofGrey = color(0x8d8a84);

  let col = plaster.mul(float(1.0).sub(dirt)).mul(float(1.0).sub(corniceShadow));
  col = mix(col, color(0x6b665c), plinth.mul(0.85));
  col = mix(col, col.mul(1.08).add(0.02), cornice);
  col = mix(col, white, clamp(frameM, 0.0, 1.0));
  col = mix(col, glass, win);
  col = mix(col, timber, clamp(doorM.add(balcony), 0.0, 1.0));
  col = mix(col, roofGrey, isRoof);
  mat.colorNode = col;

  // Warm windows at night
  const night = smoothstep(0.55, 1.35, cityUniforms.uInteriorGlow);
  const lit = step(hash21(cellKey.x.add(3.7), cellKey.y.add(boxSeed.mul(0.31))), 0.42);
  mat.emissiveNode = vec3(1.0, 0.78, 0.45).mul(win.mul(lit).mul(night).mul(1.7));
  mat.roughnessNode = mix(float(0.92), float(0.18), win);
  return mat;
}

export { createCuencaFacadeMaterial };
