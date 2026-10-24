// tools/fetch-cuenca-elevation.mjs — samples SRTM 30 m elevations (OpenTopoData public API) on a 100 m grid of the world frame
// usage: node tools/fetch-cuenca-elevation.mjs
// Writes tools/data/cuenca/elevation.json: { x0, z0, step, nx, nz, lat0, lon0, elev: [metres above sea level, row by row in z] }
// The grid is in the simulation's world frame (x grid east, z grid south); frame constants come from js/cuenca-geodata.js.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { GEO } = await import(pathToFileURL(`${root}js/cuenca-geodata.js`).href);
const { lat0: LAT0, lon0: LON0, bearingDeg, bounds } = GEO.frame;
const THETA = (bearingDeg * Math.PI) / 180;

const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180;
const S0 = Math.sin(PHI0);
const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * S0 * S0)) * Math.cos(PHI0);
const KY = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * S0 * S0, 1.5));
// world (x, z) -> lon, lat: the inverse of toWorld() in tools/build-cuenca-geodata.mjs
function toLonLat(x, z) {
  const c = Math.cos(THETA), s = Math.sin(THETA);
  const e = x * c - z * s;
  const n = -x * s - z * c;
  return [LON0 + e / KX, LAT0 + n / KY];
}

const STEP = 100;
const MARGIN = 300;
const x0 = Math.floor((bounds.minX - MARGIN) / STEP) * STEP;
const z0 = Math.floor((bounds.minZ - MARGIN) / STEP) * STEP;
const nx = Math.ceil((bounds.maxX + MARGIN - x0) / STEP) + 1;
const nz = Math.ceil((bounds.maxZ + MARGIN - z0) / STEP) + 1;
console.log(`grid ${nx} x ${nz} = ${nx * nz} points`);

const pts = [];
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pts.push(toLonLat(x0 + i * STEP, z0 + j * STEP));

const elev = new Array(pts.length).fill(null);
const BATCH = 100;
for (let k = 0; k < pts.length; k += BATCH) {
  const slice = pts.slice(k, k + BATCH);
  const locations = slice.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locations}&interpolation=bilinear`);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.status !== 'OK') throw new Error(body.error || 'bad response');
      body.results.forEach((r, i) => { elev[k + i] = r.elevation; });
      break;
    } catch (e) {
      if (attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if ((k / BATCH) % 10 === 0) console.log(`${k + slice.length}/${pts.length}`);
  await new Promise((r) => setTimeout(r, 1100)); // the public API allows one request per second
}
const missing = elev.filter((v) => v === null).length;
if (missing) throw new Error(`${missing} points without elevation`);
const out = fileURLToPath(new URL('./data/cuenca/elevation.json', import.meta.url));
fs.writeFileSync(out, JSON.stringify({ x0, z0, step: STEP, nx, nz, lat0: LAT0, lon0: LON0, elev }));
console.log(`wrote ${out}: ${Math.min(...elev)} .. ${Math.max(...elev)} m`);
