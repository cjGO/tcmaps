import test from 'node:test';
import assert from 'node:assert/strict';
import { createDensity, accumulateDensity, normalizedDensity } from '../src/rotation-density.js';
import { createDensityLayer } from '../src/rotation-density-layer.js';
import * as THREE from 'three';

const data = { bounds: { x_min_m: 0, y_min_m: 0, x_max_m: 100, y_max_m: 100 }, source: { sco_sha256: 'a', recipe_sha256: 'b', terrain_code: 'c' } };
const pose = (t, x, index, y = 25) => ({ t, x, y, z: 0, index });
const track = (samples, kind = 'player', extra = {}) => ({ samples, changes: [{ t: 0, kind }], death: Infinity, ...extra });
const replay = tracks => ({ header: { map: { source: data.source }, synthetic: false }, maxGap: 10000, tracks: new Map(tracks.map((t, i) => [i, t])) });
const sum = values => values.reduce((a, b) => a + b, 0);

test('stationary time accumulates and passing distributes the same duration across cells', () => {
  const r = createDensity(data, 10);
  accumulateDensity(r, replay([track([pose(0, 25, 1), pose(10000, 25, 2)]), track([pose(0, 0, 1, 75), pose(10000, 100, 2, 75)])]), data);
  assert.ok(Math.abs(sum(r.movement) - 20) < 1e-8);
  assert.equal(r.movement[22], 10);
  assert.ok(r.movement[72] > 0 && r.movement[72] < 2);
});

test('gaps, bot intervals, removal tails and terrain mismatches do not inflate player time', () => {
  const r = createDensity(data, 10);
  const tracks = [track([pose(0, 25, 1), pose(20000, 25, 2)]), track([pose(0, 25, 1), pose(5000, 25, 3)]),
    track([pose(0, 25, 1), pose(10000, 25, 2)], 'bot'),
    track([pose(0, 25, 1), pose(10000, 25, 2)], 'player', { death: 8000, changes: [{ t: 0, kind: 'bot' }, { t: 3000, kind: 'player' }, { t: 6000, kind: 'bot' }] })];
  accumulateDensity(r, replay(tracks), data);
  assert.equal(r.seconds, 3);
  assert.equal(sum(r.movement), 3);
  const mismatch = replay(tracks); mismatch.header.map.source = { ...data.source, terrain_code: 'different' };
  assert.equal(accumulateDensity(r, mismatch, data), false);
  const synthetic = replay(tracks); synthetic.header.synthetic = true;
  assert.equal(accumulateDensity(r, synthetic, data), false);
  assert.equal(r.rounds, 1);
});

test('only actual bot deaths count, including the upper terrain boundary', () => {
  const r = createDensity(data, 10);
  accumulateDensity(r, replay([
    track([pose(0, 100, 1, 100)], 'bot', { death: 5000, removalReason: 'death' }),
    track([pose(0, 50, 1)], 'bot', { death: 5000, removalReason: 'despawn' }),
    track([pose(0, 50, 1)], 'player', { death: 5000, removalReason: 'death' }),
  ]), data);
  assert.equal(r.deathCount, 1); assert.equal(r.deaths[99], 1);
});

test('v2 movement uses snapshot continuity and recorded death positions', () => {
  const r = createDensity(data, 10);
  const v2 = replay([
    { samples: [{ ...pose(0, 25), snapshot: 1 }, { ...pose(5000, 25), snapshot: 2 }], changes: [{ t: 0, kind: 'player' }], end: { t: Infinity } },
    { samples: [{ ...pose(5000, 75), snapshot: 2 }], changes: [{ t: 0, kind: 'bot' }], end: { t: 5000, type: 'death' } },
  ]);
  accumulateDensity(r, v2, data, true);
  assert.equal(r.seconds, 5); assert.equal(r.deathCount, 1); assert.equal(r.deaths[27], 1);
});

test('normalization is finite, volume-independent and preserves empty regions', () => {
  const values = new Float64Array(100); values[22] = 10; values[77] = 1;
  const normal = normalizedDensity(values, 10, data.bounds, 0, 1);
  assert.equal(normal[22], 255); assert.equal(normal[77], 26); assert.equal(normal[0], 0);
  assert.deepEqual(normal, normalizedDensity(values.map(v => v * 100), 10, data.bounds, 0, 1));
  assert.ok(normalizedDensity(values, 10, data.bounds, 0, .5)[77] > normal[77]);
  assert.ok(normalizedDensity(values, 10, data.bounds, 10, 1)[23] > 0);
  assert.equal(sum(normalizedDensity(new Float64Array(100), 10, data.bounds)), 0);
});

test('overlay follows the shared terrain geometry and releases its own resources', () => {
  const geometry = new THREE.BufferGeometry(), layer = createDensityLayer(geometry, data);
  const result = createDensity(data); result.movement[0] = 5;
  const settings = { movement: true, deaths: false, movementOpacity: .7, deathOpacity: .8, smoothing: 0, contrast: 1 };
  layer.update(result, settings);
  assert.equal(layer.mesh.geometry, geometry); assert.equal(layer.mesh.visible, true);
  assert.equal(layer.mesh.material.uniforms.deathOpacity.value, 0);
  assert.equal(layer.mesh.material.uniforms.density.value.image.data[0], 255);
  layer.update(result, { ...settings, movement: false }); assert.equal(layer.mesh.visible, false);
  let geometryDisposed = false; geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  layer.dispose(); assert.equal(geometryDisposed, false); geometry.dispose();
});

test('older terrain requires opt-in and a matching permanent map and variant', () => {
  const terrain = { ...data, map_id: 'test_map_107', variant_id: 'source', variant_revision: '' };
  const r = replay([track([pose(0, 25, 1), pose(5000, 25, 2)])]);
  r.header.map = { source: { ...data.source, sco_sha256: 'older' }, map_id: terrain.map_id, variant_id: 'source', variant_revision: '' };
  const density = createDensity(terrain);
  assert.equal(accumulateDensity(density, r, terrain), false);
  assert.equal(accumulateDensity(density, r, terrain, false, true), true);
  assert.equal(density.approximateRounds, 1); assert.equal(density.seconds, 5);
  r.header.map.map_id = 'test_map_108';
  assert.equal(accumulateDensity(density, r, terrain, false, true), false);
  r.header.map.map_id = terrain.map_id; r.header.map.variant_id = 'different';
  assert.equal(accumulateDensity(density, r, terrain, false, true), false);
});
