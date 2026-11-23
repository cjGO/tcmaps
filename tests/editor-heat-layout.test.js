import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Group } from 'three';
import { createEditorHeatArchive } from '../scripts/editor-heat-data.mjs';
import { createHeatController } from '../src/editor-heat-controller.js';
import { generateHeatLayout, heatLayoutField } from '../src/editor-heat-layout.js';

const bounds = { x_min_m: 0, y_min_m: 0, x_max_m: 128, y_max_m: 128 };
const source = { sco_sha256: 'archive-sco', recipe_sha256: 'archive-recipe', terrain_code: 'terrain' };
const map = { map_id: 'test_map_001', bounds, id: 'scene_slot' };
const capture = (id, identity, { synthetic = false, x = 20, tracks = true } = {}) => ({
  header: { id, synthetic, map: identity },
  maxGap: 1000,
  tracks: tracks ? new Map([['player', {
    changes: [{ t: 0, kind: 'player' }], death: 1000, removalReason: 'death',
    samples: [{ t: 0, index: 0, x, y: 30 }, { t: 1000, index: 1, x: x + 2, y: 30 }],
  }]]) : new Map(),
});

test('HEAT archive combines RAW and variant journals and omits unusable terrain', () => {
  const archive = createEditorHeatArchive([map, { ...map, map_id: 'test_map_002' }], [
    { ...map, source, variant_id: 'source' },
  ]);
  const raw = capture('raw', { id: 'old_slot', source });
  archive.add(raw, false);
  archive.add(raw, false);
  archive.add(capture('variant', { map_id: map.map_id, variant_id: 'VarA' }, { x: 90 }), false);
  archive.add({
    header: { id: 'historical', map: { source: { ...source, sco_sha256: 'previous-sco' } } },
    tracks: new Map([['bot', {
      changes: [{ t: 0, kind: 'bot' }], end: { t: 1000, type: 'death' },
      samples: [{ t: 1000, snapshot: 1, x: 60, y: 30 }],
    }]]),
  }, true);
  archive.add(capture('synthetic', { map_id: 'test_map_002' }, { synthetic: true }), false);
  archive.add(capture('slot-only', { id: map.id }), false);
  archive.add(capture('no-positions', { map_id: 'test_map_002' }, { tracks: false }), false);
  archive.add(capture('out-of-bounds', { map_id: 'test_map_002' }, { x: 400 }), false);
  const result = archive.finish();
  assert.deepEqual(Object.keys(result), [map.map_id]);
  const data = result[map.map_id];
  assert.deepEqual(data.groups.map(group => [group.variant, group.rounds]), [['source', 1], ['unidentified', 1], ['vara', 1]]);
  const field = heatLayoutField(data, '', 'both', 0);
  assert.equal(field.rounds, 3);
  assert.equal(field.playerSeconds, 2);
  assert.equal(field.deathCount, 3);
  assert.equal(heatLayoutField(data, 'vara', 'playerDeaths', 0).values[30 * field.size + 92], 1);
  assert.equal(heatLayoutField(data, 'vara', 'botDeaths', 0).values.some(Boolean), false);
});

test('HEAT layouts sample energized cells reproducibly and respect spacing and capacity', () => {
  const field = heatLayoutField({ size: 2, bounds, groups: [
    { variant: 'source', rounds: 1, cells: [[1, 1000, 0, 0]] },
  ] }, '', 'movement', 0);
  const options = { count: 20, spacing: 5, seed: 17, existing: [{ x_m: 96, y_m: 32 }], spawns: [{ x_m: 112, y_m: 16 }] };
  const points = generateHeatLayout(field, options);
  assert.deepEqual(generateHeatLayout(field, options), points);
  assert.notDeepEqual(generateHeatLayout(field, { ...options, seed: 18 }), points);
  assert.equal(points.length, options.count);
  for (const [index, point] of points.entries()) {
    assert.ok(point.x_m >= 64 && point.x_m <= 128 && point.y_m >= 0 && point.y_m <= 64);
    for (const other of [...options.existing, ...options.spawns, ...points.slice(0, index)]) {
      assert.ok(Math.hypot(point.x_m - other.x_m, point.y_m - other.y_m) >= options.spacing);
    }
  }
  assert.deepEqual(generateHeatLayout(field, { ...options, existing: Array(10000).fill(options.existing[0]) }), []);
});

test('HEAT mode stays unavailable for maps missing from the archive', async () => {
  const dom = new JSDOM('<div class="modes"></div><aside></aside>');
  const doc = dom.window.document;
  const extras = new Group();
  let entered = false;
  const controller = createHeatController({
    doc, project: { assets: [] }, extras,
    api: { setMode() { entered = true; } },
    context: () => ({ ready: true, is3D: true, state: { mode: 'navigate' } }),
  });
  controller.sync();
  await Promise.resolve();
  const button = doc.querySelector('#editor-heat');
  assert.equal(button.hidden, true);
  button.click();
  assert.equal(entered, false);
  assert.equal(doc.querySelector('#heat-panel').hidden, true);
  controller.dispose();
  assert.equal(extras.children.length, 0);
  dom.window.close();
});

test('HEAT previews are disposable and applying one commits a single asset batch', async () => {
  const dom = new JSDOM('<div class="modes"></div><aside></aside>');
  const doc = dom.window.document;
  const $ = id => doc.getElementById(id);
  const state = { mode: 'navigate', brush: { asset: 'rock', yaw_deg: 0, scale: 1 }, favorites: [],
    document: { placements: [], spawn_points: [] } };
  const calls = [];
  const api = {
    getState: () => state,
    setMode(mode) { state.mode = mode; controller.sync(); },
    placeBatch(points) { calls.push(points); state.document.placements.push(...points); },
  };
  const controller = createHeatController({
    doc, api, extras: new Group(), transform() {},
    project: { bounds, assets: [{ name: 'rock', label: 'Rock', group: 'Scenery' }] },
    context: () => ({
      ready: true, is3D: true, state, viewer: { draw() {}, exitExplorer() {} },
      data: { grid_size: 2, xs: [0, 128], ys: [0, 128], heights_mm: [0, 0, 0, 0],
        vertical_scale: 1, height_order: 'x-major, y-minor' },
      library: { create: async () => new Group() },
    }),
    loadHeat: async () => ({ size: 128, bounds, groups: [{ variant: 'source', rounds: 1, cells: [[8256, 1000, 1, 0]] }] }),
  });
  const settled = () => new Promise(resolve => setImmediate(resolve));
  try {
    controller.sync();
    await settled();
    assert.equal($('editor-heat').hidden, false);
    $('editor-heat').click();
    await settled();
    assert.equal($('heat-panel').hidden, false);
    assert.match($('heat-evidence').textContent, /1 recording.*1 death$/);
    $('heat-count').value = '2';
    $('heat-preview').click();
    await settled();
    assert.equal($('heat-place').disabled, false);
    assert.equal(calls.length, 0);

    api.setMode('navigate');
    assert.equal($('heat-place').disabled, true);
    assert.equal($('heat-panel').hidden, true);
    $('editor-heat').click();
    $('heat-preview').click();
    await settled();
    $('heat-place').click();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    assert.ok(calls[0].every(p => p.asset === 'rock'));
  } finally {
    controller.dispose();
    dom.window.close();
  }
});
