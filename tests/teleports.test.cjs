const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, CUENCA_LANDMARKS, blockAt, nearestRoads, SPAWN, terrainHeightAt, groundHeightAt, getLocationLabel;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, CUENCA_LANDMARKS, blockAt, nearestRoads, SPAWN, terrainHeightAt, groundHeightAt, getLocationLabel } = await import('../js/city-config.js'));
});

test('every teleport button has a destination on a real roadway', () => {
  const buttons = [...read('index.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(TELEPORT_LOCATIONS).sort(), buttons.sort());
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    assert.equal(blockAt(point.x, point.z), null, `${name} lands outside building blocks`);
    const nearby = nearestRoads(point.x, point.z, 20, false);
    assert.ok(nearby.some(({ road, dist }) => dist < road.w / 2 + 1), `${name} lands within a street's width`);
  }
});

test('the spawn is on the street beside Parque Calderón, looking at the cathedral', () => {
  const cathedral = CUENCA_LANDMARKS.find((l) => l.id === 'catedral');
  assert.ok(cathedral, 'the cathedral is among the landmarks');
  assert.equal(SPAWN, TELEPORT_LOCATIONS.calderon);
  const distance = Math.hypot(cathedral.x - SPAWN.x, cathedral.z - SPAWN.z);
  assert.ok(distance > 40 && distance < 250, `cathedral is ${Math.round(distance)} m away`);
  const alignment = ((cathedral.x - SPAWN.x) * Math.sin(SPAWN.heading) + (cathedral.z - SPAWN.z) * Math.cos(SPAWN.heading)) / distance;
  assert.ok(alignment > 0.999, 'the player faces the cathedral');
});

test('the terrain is 0 at the origin and the walking surface follows it', () => {
  assert.ok(Math.abs(terrainHeightAt(0, 0)) < 2.5, 'Parque Calderón is the height reference');
  const hills = terrainHeightAt(39, 2868); // Turi, south of the city
  assert.ok(hills > 20, `Turi stands ${hills} m above the square`);
  for (const point of Object.values(TELEPORT_LOCATIONS)) {
    const road = groundHeightAt(point.x, point.z, 'car');
    assert.ok(Math.abs(road - terrainHeightAt(point.x, point.z) - 0.03) < 1e-9, 'a road is its terrain plus the surface');
  }
});

test('streets are named after real Cuenca streets', () => {
  const label = getLocationLabel(SPAWN.x, SPAWN.z);
  assert.ok(label.length > 0 && label !== 'Cuenca', `a name resolves at the spawn: ${label}`);
});

test('preset teleports share arrival resets and mark the resolved landing point', () => {
  const main = read('js/main.js');
  const start = main.indexOf('  function teleportTo(');
  const end = main.indexOf('  const openMapBtn', start);
  const handlers = new Map();
  const calls = [];
  const landed = { x: 12.5, z: -40 };
  const environment = {
    TELEPORT_LOCATIONS,
    document: { getElementById: () => null },
    createMinimap: () => ({ update() {} }),
    controllerManager: {
      teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; }
    },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: { resetForTeleport: () => calls.push(['camera']) },
    selectCamera: (...args) => calls.push(['selectCamera', ...args]),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    teleportButtons: Object.keys(TELEPORT_LOCATIONS).map((key) => ({
      getAttribute: () => key,
      addEventListener: (_event, handler) => handlers.set(key, handler)
    })),
    closePopovers: () => {}
  };
  const context = vm.createContext(environment);
  vm.runInContext(`${main.slice(start, end)}\nglobalThis.mapSystem = mapSystem;`, context);
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    calls.length = 0;
    handlers.get(name)();
    assert.deepEqual(calls, [
      ['teleport', point.x, point.z, point.heading], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true]
    ]);
    assert.equal(context.mapSystem.waypoint.x, landed.x);
    assert.equal(context.mapSystem.waypoint.z, landed.z);
  }
});
