import test from 'node:test';
import assert from 'node:assert/strict';
import { createDensity, accumulateDensity, normalizedDensity, differenceDensity } from '../src/rotation-density.js';
import { createDensityLayer } from '../src/rotation-density-layer.js';
import * as THREE from 'three';
import { readFile, readdir, open } from 'node:fs/promises';
import { recordedVariantId } from '../src/map-variants.js';
import { densityFromRecordings } from '../src/rotation-density-recordings.js';

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

test('permanent map identity combines source versions and variants automatically', () => {
  const terrain = { ...data, map_id: 'test_map_107', variant_id: 'source', variant_revision: '' };
  const r = replay([track([pose(0, 25, 1), pose(5000, 25, 2)])]);
  r.header.map = { source: { ...data.source, sco_sha256: 'older' }, map_id: terrain.map_id, variant_id: 'VarA', variant_revision: 'another-revision' };
  const density = createDensity(terrain);
  assert.equal(accumulateDensity(density, r, terrain), true);
  assert.equal(density.seconds, 5);
  r.header.map.variant_id = 'source';
  assert.equal(accumulateDensity(density, r, terrain), true);
  assert.equal(density.rounds, 2);
  r.header.map.map_id = 'test_map_108';
  r.header.map.source = terrain.source;
  assert.equal(accumulateDensity(density, r, terrain), false, 'A different named map stays excluded even with identical source hashes');
  delete r.header.map.map_id;
  r.header.map.source = { ...data.source, sco_sha256: 'older' };
  assert.equal(accumulateDensity(density, r, terrain, false, terrain.map_id), true, 'Legacy recordings follow their rotation replay link');
});

test('all nine linked test_map_116 recordings contribute movement and bot deaths', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('lib/rotation-topology.json', root), 'utf8'));
  const entry = manifest.maps.find(map => map.map_id === 'test_map_116');
  const terrain = { ...entry, ...JSON.parse(await readFile(new URL('public' + entry.url, root), 'utf8')) };
  const recordings = [];
  for (const folder of ['replays', 'experimental_replays']) {
    for (const filename of await readdir(new URL(folder + '/', root))) {
      if (!/\.(jsonl|replay\.json)$/.test(filename)) continue;
      let header;
      if (filename.endsWith('.replay.json')) {
        const bundle = JSON.parse(await readFile(new URL(`${folder}/${filename}`, root), 'utf8'));
        header = JSON.parse(bundle.journal.split('\n', 1)[0]);
      } else {
        const file = await open(new URL(`${folder}/${filename}`, root));
        try {
          const buffer = Buffer.alloc(16384);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          header = JSON.parse(buffer.subarray(0, bytesRead).toString().split('\n', 1)[0]);
        } finally { await file.close(); }
      }
      if (header.map.map_id ? header.map.map_id !== terrain.map_id : header.map.id !== terrain.id) continue;
      recordings.push({ filename, version: header.version, map: header.map.id, map_id: header.map.map_id, variant_id: recordedVariantId(header.map, terrain.map_id), synthetic: header.synthetic, url: `${folder}/${filename}` });
    }
  }
  assert.equal(recordings.length, 9);
  const { result, skipped, failed } = await densityFromRecordings(recordings, terrain, recording => readFile(new URL(recording.url, root), 'utf8'));
  assert.equal(failed, 0);
  assert.equal(skipped, 0);
  assert.equal(result.rounds, 9);
  assert.ok(result.seconds > 0);
  assert.ok(result.deathCount > 0);
  assert.ok(sum(result.movement) > 0);
  assert.equal(sum(result.deaths), result.deathCount);
  const load = recording => readFile(new URL(recording.url, root), 'utf8');
  const source = await densityFromRecordings(recordings, { ...terrain, selectedVariant: 'source' }, load);
  const variant = await densityFromRecordings(recordings, { ...terrain, selectedVariant: 'vara' }, load);
  assert.equal(source.result.rounds, 3);
  assert.equal(variant.result.rounds, 6);
  assert.equal(source.failed + variant.failed, 0);
  assert.equal(source.skipped, 6);
  assert.equal(variant.skipped, 3);
  assert.ok(source.result.seconds > 0 && variant.result.seconds > 0);
  assert.ok(source.result.deathCount > 0 && variant.result.deathCount > 0);
  assert.ok(Math.abs(source.result.seconds + variant.result.seconds - result.seconds) < 1e-6);
  assert.equal(source.result.deathCount + variant.result.deathCount, result.deathCount);
  const comparison = await densityFromRecordings(recordings, { ...terrain, selectedVariant: 'all', comparisonVariant: 'vara' }, load);
  assert.equal(comparison.failed, 0);
  assert.deepEqual(comparison.result.comparison.source.deaths, source.result.deaths);
  assert.deepEqual(comparison.result.comparison.target.deaths, variant.result.deaths);
  assert.equal(comparison.result.comparison.source.rounds, 3);
  assert.equal(comparison.result.comparison.target.rounds, 6);

  for (let i = 0; i < result.movement.length; i++) {
    assert.ok(Math.abs(source.result.movement[i] + variant.result.movement[i] - result.movement[i]) < 1e-6);
    assert.equal(source.result.deaths[i] + variant.result.deaths[i], result.deaths[i]);
  }
});

test('selected variant matches exported filenames and recorded names across revisions', () => {
  const terrain = { ...data, map_id: 'test_map_116', selectedVariant: 'vara' };
  const r = replay([track([pose(0, 25, 1), pose(5000, 25, 2)])]);
  for (const map of [
    { variant_id: 'VarA', variant_revision: 'old' },
    { variant_id: 'test_map_116_VarA.placements.json', variant_revision: 'new' },
    { map_name: 'test_map_116_VarA' },
  ]) {
    r.header.map = { ...map, map_id: terrain.map_id, source: data.source };
    assert.equal(accumulateDensity(createDensity(terrain), r, terrain), true);
  }
  for (const variant_id of ['source', 'RAW', 'VarB', undefined]) {
    r.header.map = { map_id: terrain.map_id, variant_id, source: data.source };
    assert.equal(accumulateDensity(createDensity(terrain), r, terrain), false);
  }
});

test('difference uses per-recording values on a shared signed scale', () => {
  const source = createDensity(data, 10), target = createDensity(data, 10);
  source.rounds = 1; target.rounds = 2;
  source.deaths[0] = 4; target.deaths[0] = 8;
  source.deaths[1] = 6; target.deaths[1] = 4;
  source.deaths[2] = 2; target.deaths[2] = 12;
  const difference = differenceDensity({ source, target }, 'deaths', 'per-recording', 0, 1);
  assert.equal(difference.positive[0] + difference.negative[0], 0, 'Equal per-recording density is clear');
  assert.equal(difference.negative[1], 255, 'RAW has four more deaths per recording');
  assert.equal(difference.positive[2], 255, 'Variant has four more deaths per recording on the same scale');
  assert.equal(difference.positive[1] + difference.negative[2], 0);
  assert.equal(difference.positive[99] + difference.negative[99], 0);
  const totals = differenceDensity({ source, target }, 'deaths', 'totals', 0, 1);
  assert.ok(totals.positive[0] > 0, 'Totals expose the extra recorded volume');
  source.movement[0] = .3; target.movement[0] = .6 + 1e-15;
  const equal = differenceDensity({ source, target }, 'movement', 'per-recording', 10, .7);
  assert.equal(sum(equal.positive) + sum(equal.negative), 0, 'Roundoff does not create false changes');
});

test('difference renderer switches metrics, restores normal layers, and hides missing groups', () => {
  const geometry = new THREE.BufferGeometry(), layer = createDensityLayer(geometry, data);
  const result = createDensity(data);
  result.comparison = { source: createDensity(data), target: createDensity(data) };
  result.comparison.source.rounds = result.comparison.target.rounds = 1;
  result.comparison.source.deaths[0] = 5;
  result.comparison.target.movement[0] = 5;
  const settings = { comparison: true, compareMetric: 'deaths', compareScale: 'per-recording', compareOpacity: .8, smoothing: 0, contrast: 1, movement: true, movementOpacity: .7, deaths: false, deathOpacity: .8 };
  layer.update(result, settings);
  const pixels = layer.mesh.material.uniforms.density.value.image.data;
  assert.equal(layer.mesh.visible, true);
  assert.equal(layer.mesh.material.uniforms.comparison.value, true);
  assert.equal(pixels[0], 0); assert.equal(pixels[1], 255);
  layer.update(result, { ...settings, compareMetric: 'movement' });
  assert.equal(pixels[0], 255); assert.equal(pixels[1], 0);
  layer.update(result, { ...settings, comparison: false });
  assert.equal(layer.mesh.material.uniforms.comparison.value, false);
  result.comparison.target.rounds = 0;
  layer.update(result, settings);
  assert.equal(layer.mesh.visible, false);
  layer.dispose(); geometry.dispose();
});
