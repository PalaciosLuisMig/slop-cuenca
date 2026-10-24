import assert from 'node:assert/strict';
import test from 'node:test';

const { GEO } = await import('../js/cuenca-geodata.js');

test('the generated geodata has the layers the game reads', () => {
  for (const key of ['frame', 'roads', 'roadGraph', 'terrain', 'rivers', 'water', 'blocks', 'parks', 'landmarks']) {
    assert.ok(GEO[key], `${key} is present`);
  }
  assert.ok(GEO.roads.length > 3000, 'the street network is dense');
  assert.ok(GEO.blocks.length > 1000, 'the city is cut into blocks');
  assert.ok(GEO.frame.bounds.maxX > GEO.frame.bounds.minX && GEO.frame.bounds.maxZ > GEO.frame.bounds.minZ);
});

test('every block is a closed outline whose lots lie near it', () => {
  for (const [outline, rects, , , , frames] of GEO.blocks) {
    assert.ok(outline.length >= 6 && outline.length % 2 === 0, 'an outline of at least three points');
    assert.ok(Array.isArray(rects));
    for (const [theta, px, pz, lots, height] of frames || []) {
      assert.ok(Number.isFinite(theta) && Number.isFinite(px) && Number.isFinite(pz) && height >= 0);
      assert.equal(lots.length, 1);
      const [x0, x1, z0, z1] = lots[0];
      assert.ok(x1 > x0 && z1 > z0 && px > x0 && px < x1 && pz > z0 && pz < z1, 'a lot is centred on its pivot');
    }
  }
});

test('the road graph links reference real nodes, and the terrain grid matches its size', () => {
  const { nodes, links } = GEO.roadGraph;
  for (const [a, b, name, , , dir] of links) {
    assert.ok(a >= 0 && a < nodes.length / 2 && b >= 0 && b < nodes.length / 2);
    assert.ok(Number.isInteger(name) && [-1, 0, 1].includes(dir));
  }
  const { nx, nz, h } = GEO.terrain;
  assert.equal(h.length, nx * nz);
});

test('the cathedral and its square are in the data', () => {
  const cathedral = GEO.landmarks['Catedral de la Inmaculada Concepción'];
  assert.ok(cathedral && cathedral.h > 40 && cathedral.worship === 1);
  assert.ok(Math.hypot(cathedral.x, cathedral.z) < 200, 'it stands next to the origin, Parque Calderón');
});
