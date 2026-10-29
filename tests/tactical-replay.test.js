import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseJournal, soldierAt, soldierViewAt, facingBetween, movementHeatmap, matchTerrain, parseBundle, unitCategory, playerLabel } from '../src/tactical-replay.js';

const journal = () => fs.readFileSync(new URL('./fixtures/SYNTHETIC-tactical-demo.jsonl', import.meta.url), 'utf8');
const replay = () => parseJournal(journal());
test('optional recorded names and categories validate and follow metadata changes', () => {
  const rows = journal().trim().split('\n').map(JSON.parse);
  Object.assign(rows.find(row => row.type === 'entity' && row.id === 1), { player_name: 'First name', unit_category: 'artillery' });
  Object.assign(rows.find(row => row.type === 'change' && row.id === 1), { player_name: '<New name>', unit_category: 'cavalry' });
  const encode = () => rows.map(JSON.stringify).join('\n') + '\n';
  const r = parseJournal(encode());
  assert.equal(soldierAt(r.tracks.get(1), 20000, r).unit_category, 'artillery');
  assert.equal(playerLabel(soldierAt(r.tracks.get(1), 30000, r)), '<New name>');
  assert.equal(playerLabel({ id: 9, controller: 3 }), 'Player #3');
  assert.equal(playerLabel({ id: 9, controller: false }), 'Player #9');
  rows[1].player_name = 123;
  assert.throws(() => parseJournal(encode()), /player name/);
  rows[1].player_name = false; rows[1].unit_category = 'invalid';
  assert.throws(() => parseJournal(encode()), /unit category/);
  for (const cls of [14, 15, 16, 17, 18, 19]) assert.equal(unitCategory({ class: cls, mounted: false }), 'cavalry');
  for (const cls of [20, 21]) assert.equal(unitCategory({ class: cls, mounted: true }), 'artillery');
  assert.equal(unitCategory({ class: 0 }), 'infantry');
  assert.equal(unitCategory({ class: 4, mounted: true }), 'cavalry');
  assert.equal(unitCategory({ class: 14, unit_category: 'infantry' }), 'infantry');
});

test('unit shapes and player labels follow playback, visibility filters and disposal', async () => {
  const { createReplayLayer } = await import('../src/replay-layer.js');
  const { replay: r, data } = await parseBundle(fs.readFileSync(new URL('./fixtures/SYNTHETIC-tactical-demo.replay.json', import.meta.url), 'utf8'));
  Object.assign(r.tracks.get(40).changes[0], { player_name: '<Player forty>', unit_category: 'artillery' });
  Object.assign(r.tracks.get(250).changes[0], { class: 14 });
  const originalDocument = globalThis.document;
  // Exercise text drawing without a native canvas dependency in Node.
  const drawn = [];
  globalThis.document = { createElement() { return { getContext() { return {
    measureText: text => ({ width: text.length * 14 }), fillRect() {}, fillText(text) { drawn.push(text); }
  }; } }; } };
  let group, onHeight;
  const viewer = { heightScale: 1, addLayer(value) { group = value; }, draw() {}, onHeightChange(fn) { onHeight = fn; return () => {}; } };
  const layer = createReplayLayer(viewer, data, r);
  try {
    assert.equal(layer.update({ t: 20000 }), 320);
    assert.equal(group.children.filter(child => child.isSprite).length, 0);
    assert.equal(group.getObjectByName('replay-artillery').count, 1);
    assert.equal(group.getObjectByName('replay-cavalry').count, 71);
    assert.equal(group.getObjectByName('replay-infantry').count, 248);
    layer.update({ playerNames: true });
    const label = group.getObjectByName('replay-player-40');
    assert.equal(label.userData.text, '<Player forty>'); assert.ok(drawn.includes('<Player forty>'));
    assert.equal(group.children.filter(child => child.isSprite && child.visible).length, 8);
    const firstZ = label.position.z;
    viewer.heightScale = 4; onHeight(); assert.notEqual(label.position.z, firstZ);
    layer.update({ t: 30000 }); assert.equal(group.getObjectByName('replay-player-1').visible, true);
    layer.update({ t: 20000 }); assert.equal(group.getObjectByName('replay-player-1').visible, false);
    layer.update({ players: false }); assert.equal(label.visible, false);
    layer.update({ players: true, soldier: '1' }); assert.equal(label.visible, false);
    layer.update({ soldier: '', followSoldier: '40' }); assert.equal(label.visible, false);
    layer.update({ followSoldier: '', playerNames: false }); assert.equal(label.visible, false);
    layer.update({ playerNames: true, t: 90000 }); assert.equal(label.visible, false);
    layer.update({ t: 45000 }); assert.equal(group.getObjectByName('replay-cavalry').count, 71); // dismounted cavalry keeps its role
    let disposed = false; label.material.map.addEventListener('dispose', () => { disposed = true; });
    layer.dispose(); assert.equal(disposed, true); assert.equal(group.children.some(child => child.isSprite), false);
  } finally { globalThis.document = originalDocument; }
});
test('soldier camera follows interpolation, holds on death and gaps, and seeks without future poses', () => {
  const r = replay(), track = r.tracks.get(2);
  const moving = soldierViewAt(track, 22500, r);
  assert.deepEqual(moving, { ...soldierAt(track, 22500, r), ended: false, holding: false });
  const dead = soldierViewAt(track, 45000, r);
  assert.deepEqual(dead, { ...track.samples.at(-1), ended: true, holding: true });
  assert.deepEqual(soldierViewAt(track, 110000, r), dead);
  assert.deepEqual(soldierViewAt(track, 22500, r), moving);
  assert.equal(soldierViewAt(track, 19999, r), null);
  assert.equal(soldierViewAt(undefined, 20000, r), null);
  const late = r.tracks.get(321);
  assert.equal(soldierViewAt(late, 59999, r), null);
  assert.ok(soldierViewAt(late, 60000, r));
  const gapTrack = r.tracks.get(1), gap = soldierViewAt(gapTrack, 90000, r);
  assert.equal(gap.holding, true);
  assert.equal(gap.x, gapTrack.samples.filter(p => p.t <= 90000).at(-1).x);
  assert.equal(soldierViewAt(gapTrack, 110000, r).holding, false);
});
test('schema, torn tail and bounded input validation', () => {
  assert.throws(() => parseJournal(journal().replace('"version":1', '"version":2')), /Unsupported/);
  assert.throws(() => parseJournal('x\n'), /Malformed/);
  assert.throws(() => parseJournal(journal().replace('"team":1', '"team":"<script>"')), /metadata/);
  const cut = journal().lastIndexOf('{"type":"end"');
  const incomplete = parseJournal(journal().slice(0, cut) + '{"type":');
  assert.equal(incomplete.incomplete, true); assert.equal(incomplete.truncated, true);
  assert.throws(() => parseJournal(journal().replace('"t":25000', '"t":1')), /ordering/);
});
test('no interpolation before birth, after death, or across large gaps', () => {
  const r = replay(), dead = r.tracks.get(2);
  assert.equal(soldierAt(dead, 19999, r), null); assert.ok(soldierAt(dead, 44999, r));
  assert.equal(soldierAt(dead, 45000, r), null);
  assert.equal(soldierAt(r.tracks.get(321), 59999, r), null);
  assert.ok(soldierAt(r.tracks.get(321), 60000, r));
  assert.equal(soldierAt(r.tracks.get(1), 90000, r), null);
  assert.ok(soldierAt(r.tracks.get(1), 110000, r));
});
test('position/facing interpolation, takeover, mount changes and stable lifetimes', () => {
  const r = replay(), track = r.tracks.get(1), a = soldierAt(track, 20000, r), b = soldierAt(track, 25000, r);
  assert.equal(soldierAt(track, 22500, r).x, (a.x + b.x) / 2);
  assert.equal(facingBetween(359, 1, .5), 0);
  assert.equal(soldierAt(track, 29999, r).kind, 'bot'); assert.equal(soldierAt(track, 30000, r).kind, 'player');
  assert.equal(soldierAt(r.tracks.get(250), 44999, r).mounted, true);
  assert.equal(soldierAt(r.tracks.get(250), 45000, r).mounted, false);
});
test('exact version match, no slot fallback, heatmap deduplication and time weighting', () => {
  const r = replay(), data = { schema_version: 1, source: r.header.map.source, height_data_sha256: 'a'.repeat(64), bounds: { x_min_m: 0, y_min_m: 0, x_max_m: 1000, y_max_m: 1000 } };
  assert.throws(() => matchTerrain(r, { ...data, source: { ...data.source, sco_sha256: 'b'.repeat(64) } }), /mismatch/);
  const a = movementHeatmap([r], data), b = movementHeatmap([r, r], data);
  assert.equal(a.soldier_seconds, b.soldier_seconds);
  assert.ok(a.cells.some(c => c.mounted)); assert.ok(a.cells.some(c => c.kind === 'player'));
  const track = { id: 1, birth: 0, death: Infinity, changes: [{ t: 0, team: 0, kind: 'bot' }], samples: [0, 5000, 10000].map((t, i) => ({ t, index: i, x: 5, y: 5, mounted: false })) };
  const fine = { ...r, tracks: new Map([[1, track]]) };
  const coarse = { ...r, maxGap: 20000, tracks: new Map([[1, { ...track, samples: [track.samples[0], { ...track.samples[2], index: 1 }] }]]) };
  assert.equal(movementHeatmap([fine], data).soldier_seconds, 10);
  assert.equal(movementHeatmap([coarse], data).soldier_seconds, 10);
});
test('bundle validates embedded asset checksum', async () => {
  await assert.rejects(parseBundle(JSON.stringify({ schema: 'warband-replay-bundle', version: 1, journal: journal(), terrain_json: '{}', terrain_sha256: '0'.repeat(64) })), /checksum/);
});

test('movement history clips trails and heat to the clock, supports reverse seek and ownership filters', async () => {
  const { createMovementHistory } = await import('../src/replay-history.js');
  const r = replay(), data = { bounds: { x_min_m: 0, y_min_m: 0, x_max_m: 1000, y_max_m: 1000 } };
  const track = { id: 7, birth: 0, death: 9000,
    changes: [{ t: 0, team: 0, kind: 'bot', owner: 2 }, { t: 2500, team: 0, kind: 'player', owner: 3 }],
    samples: [0, 5000, 10000].map((t, index) => ({ t, index, x: 5 + t / 1000, y: 5, z: 0 })) };
  const recording = { ...r, first: 0, coverageEnd: 10000, tracks: new Map([[7, track]]) };
  const history = createMovementHistory(recording, data);
  const seconds = t => history.heatAt(t).reduce((sum, v) => sum + v, 0);
  assert.equal(seconds(0), 0); assert.equal(seconds(1250), 1.25);
  assert.equal(seconds(9000), 9); assert.equal(seconds(10000), 9);
  assert.equal(seconds(1250), 1.25); // reverse seek does not retain future exposure
  assert.equal(history.completed(1250), 0);
  assert.equal(history.partial(1250)[0].to.x, 6.25);
  assert.equal(history.completed(2500), 1);
  assert.equal(history.partial(9000).length, 0);
  assert.equal(createMovementHistory(recording, data, { squad: '0:2' }).heatAt(10000).reduce((a, b) => a + b, 0), 2.5);
  assert.equal(createMovementHistory(recording, data, { bots: false }).heatAt(10000).reduce((a, b) => a + b, 0), 6.5);
  assert.equal(createMovementHistory(recording, data, { soldier: '8' }).segments.length, 0);
  const gap = { ...track, samples: [track.samples[0], { ...track.samples[1], index: 3 }] };
  assert.equal(createMovementHistory({ ...recording, tracks: new Map([[7, gap]]) }, data).segments.length, 0);
});

test('replay layer reveals cached trail geometry and rewinds heat without future cells', async () => {
  const { createReplayLayer } = await import('../src/replay-layer.js');
  const { replay: r, data } = await parseBundle(fs.readFileSync(new URL('./fixtures/SYNTHETIC-tactical-demo.replay.json', import.meta.url), 'utf8'));
  let group, onHeight;
  const viewer = { heightScale: 1, addLayer(value) { group = value; }, draw() {}, onHeightChange(fn) { onHeight = fn; return () => {}; } };
  const layer = createReplayLayer(viewer, data, r);
  layer.update({ t: 22500, trails: true, heatmap: true });
  const trails = group.children.filter(child => child.isLineSegments);
  assert.equal(trails[0].geometry.drawRange.count, 0);
  assert.ok(trails[1].geometry.drawRange.count > 0);
  assert.equal(trails[0].material.opacity, .25);
  for (const opacity of [0, .25, 1]) {
    layer.update({ trailOpacity: opacity });
    assert.ok(trails.every(trail => trail.material.opacity === opacity));
  }
  layer.update({ trailOpacity: .25 });
  const heat = group.children.find(child => child.geometry?.type === 'PlaneGeometry');
  assert.ok(heat.instanceColor.array.some(value => value > 0));
  layer.update({ t: 60000 });
  assert.ok(trails[0].geometry.drawRange.count > 0);
  const cached = trails[0].geometry.getAttribute('position');
  layer.update({ t: 62500 });
  assert.equal(trails[0].geometry.getAttribute('position'), cached);
  layer.update({ t: r.first });
  assert.equal(trails[0].geometry.drawRange.count, 0);
  assert.equal(trails[1].geometry.drawRange.count, 0);
  assert.ok(heat.instanceColor.array.every(value => value === 0));
  viewer.heightScale = 4; onHeight();
  assert.equal(layer.update({ t: 60000, soldier: '1' }), 1);
  layer.dispose(); assert.equal(group.parent, null);
});


test('bot death estimates use last observation and exclude despawns, unobserved deaths and player control', async () => {
  const { botDeathMarkers } = await import('../src/replay-history.js');
  const r = replay();
  assert.equal(r.tracks.get(2).removalReason, 'death');
  const markers = botDeathMarkers(r);
  assert.equal(markers.length, 29);
  const row = markers.find(m => m.id === 2), sample = r.tracks.get(2).samples.at(-1);
  assert.equal(row.t, 45000); assert.equal(row.sampleTime, sample.t);
  assert.equal(row.x, sample.x); assert.equal(row.y, sample.y); assert.equal(row.z, sample.z);
  assert.equal(row.ageMs, 45000 - sample.t);
  const original = r.tracks.get(2);
  const variants = [
    { ...original, id: 700, removalReason: 'despawn_observed' },
    { ...original, id: 701, removalReason: 'agent_id_reused' },
    { ...original, id: 702, samples: [] },
    { ...original, id: 703, changes: [...original.changes, { ...original.changes.at(-1), t: 44000, kind: 'player' }] },
    { ...original, id: 704, death: Infinity },
    { ...original, id: 705, samples: [{ ...sample, t: 20000 }] }
  ];
  const estimates = botDeathMarkers({ ...r, tracks: new Map(variants.map(track => [track.id, track])) });
  assert.equal(estimates.length, 1); assert.equal(estimates[0].id, 705);
  assert.equal(estimates[0].ageMs, 25000); assert.equal(estimates[0].x, sample.x);
});

test('death marker instances persist, toggle and scrub with filters and height scale', async () => {
  const { createReplayLayer } = await import('../src/replay-layer.js');
  const { botDeathMarkers } = await import('../src/replay-history.js');
  const { replay: r, data } = await parseBundle(fs.readFileSync(new URL('./fixtures/SYNTHETIC-tactical-demo.replay.json', import.meta.url), 'utf8'));
  let group, heightChanged;
  const viewer = { heightScale: 1, addLayer(value) { group = value; }, draw() {}, onHeightChange(fn) { heightChanged = fn; return () => {}; } };
  const layer = createReplayLayer(viewer, data, r);
  layer.update({ t: 44999, deaths: true });
  const mesh = group.getObjectByName('bot-deaths'); assert.equal(mesh.count, 0);
  layer.update({ t: 45000 }); assert.equal(mesh.count, 29);
  layer.update({ t: 110000 }); assert.equal(mesh.count, 29);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, .25);
  const matrices = mesh.instanceMatrix.version;
  for (const opacity of [0, .25, 1]) {
    layer.update({ deathOpacity: opacity });
    assert.equal(mesh.material.opacity, opacity);
    assert.equal(mesh.count, 29);
    assert.equal(mesh.instanceMatrix.version, matrices);
  }
  layer.update({ deaths: false }); assert.equal(mesh.visible, false);
  layer.update({ deaths: true }); assert.equal(mesh.visible, true); assert.equal(mesh.count, 29);
  assert.equal(mesh.instanceMatrix.version, matrices);
  layer.update({ t: 20000 }); assert.equal(mesh.count, 0);
  layer.update({ t: 60000, soldier: '2' }); assert.equal(mesh.count, 1);
  layer.update({ bots: false }); assert.equal(mesh.count, 0);
  layer.update({ bots: true, soldier: '', squad: '0:3' });
  assert.equal(mesh.count, botDeathMarkers(r).filter(row => row.team === 0 && row.owner === 3).length);
  viewer.heightScale = 4; heightChanged(); assert.ok(mesh.instanceMatrix.version > matrices);
  layer.dispose();
});

test('bot strength counts lifetimes through gaps, control/team changes, removals and reverse seeking', async () => {
  const { botStrengthHistory, botStrengthAt } = await import('../src/replay-strength.js');
  const track = (id, birth, death, changes, samples = []) => ({ id, birth, death, changes, samples });
  const recording = { first: 1000, coverageEnd: 10000, tracks: new Map([
    [1, track(1, 0, 5000, [{ t: 0, team: 0, kind: 'bot' }])], // counted without any positions
    [2, track(2, 1000, Infinity, [
      { t: 1000, team: 1, kind: 'bot' }, { t: 3000, team: 1, kind: 'player' },
      { t: 4000, team: 0, kind: 'bot' }, { t: 6000, team: 1, kind: 'bot' }
    ])],
    [3, track(3, 5000, 5000, [{ t: 5000, team: 0, kind: 'bot' }])], // no duration
    [4, track(4, 7000, 8000, [{ t: 7000, team: -1, kind: 'bot' }])],
    [5, track(5, 11000, Infinity, [{ t: 11000, team: 0, kind: 'bot' }])],
    [6, track(6, 1000, 9000, [{ t: 1000, team: 1, kind: 'player' }])]
  ]) };
  const history = botStrengthHistory(recording);
  assert.deepEqual(history.teams, [-1, 0, 1]);
  for (const [t, expected] of [
    [1000, [0, 1, 1]], [2999, [0, 1, 1]], [3000, [0, 1, 0]], [4000, [0, 2, 0]],
    [5000, [0, 1, 0]], [6000, [0, 0, 1]], [7000, [1, 0, 1]], [8000, [0, 0, 1]],
    [10000, [0, 0, 1]], [1000, [0, 1, 1]]
  ]) assert.deepEqual(botStrengthAt(history, t), expected, `at ${t}`);
  assert.equal(history.max, 2);
  const empty = botStrengthHistory({ ...recording, tracks: new Map() });
  assert.deepEqual(botStrengthAt(empty, 1000), [0, 0]);
  assert.equal(empty.max, 1);
});

test('bot strength in synthetic replay persists through position gaps and excludes player takeover', async () => {
  const { botStrengthHistory, botStrengthAt } = await import('../src/replay-strength.js');
  const r = replay(), history = botStrengthHistory(r);
  for (const t of [r.first, 30000, 45000, 60000, 90000, r.coverageEnd, r.first]) {
    const expected = history.teams.map(team => [...r.tracks.values()].filter(track => {
      const meta = track.changes.filter(change => change.t <= t).at(-1);
      return track.birth <= t && t < track.death && meta?.kind === 'bot' && meta.team === team;
    }).length);
    assert.deepEqual(botStrengthAt(history, t), expected);
  }
  assert.deepEqual(botStrengthAt(history, 90000), botStrengthAt(history, 110000));
});

test('unit type filters track role changes and mounting, with independent trail choices', async () => {
  const { createMovementHistory, matchesHistory } = await import('../src/replay-history.js');
  const r = replay(), data = { bounds: { x_min_m: 0, y_min_m: 0, x_max_m: 1000, y_max_m: 1000 } };
  const track = { id: 7, birth: 0, death: Infinity,
    changes: [{ t: 0, team: 0, kind: 'bot', class: 0 }, { t: 7500, team: 0, kind: 'bot', class: 20 }],
    samples: [0, 5000, 10000].map((t, index) => ({ t, index, x: 5, y: 5, z: 0, mounted: index === 1 })) };
  const recording = { ...r, first: 0, coverageEnd: 10000, tracks: new Map([[7, track]]) };
  const seconds = history => history.heatAt(10000).reduce((sum, v) => sum + v, 0);
  for (const [type, expected] of [['infantry', 5], ['cavalry', 2.5], ['artillery', 2.5]]) {
    assert.equal(seconds(createMovementHistory(recording, data, { unitTypes: [type] })), expected);
    assert.equal(movementHeatmap([recording], { ...data, schema_version: 1, source: r.header.map.source, height_data_sha256: 'a'.repeat(64) }, { unitTypes: [type] }).soldier_seconds, expected);
  }
  assert.equal(matchesHistory({ kind: 'bot', class: 14, mounted: false }, 7, { unitTypes: ['cavalry'] }), true);
  assert.equal(matchesHistory({ kind: 'bot', class: 20, mounted: true }, 7, { unitTypes: ['cavalry'] }), false);
  const trails = createMovementHistory(recording, data, { trailUnitTypes: ['cavalry'] });
  assert.equal(trails.segments.length, 1); assert.equal(trails.segments[0].start, 5000);
  assert.equal(trails.partial(6000).length, 1); assert.equal(trails.partial(8000).length, 0);
  assert.equal(seconds(trails), 10);
  const none = createMovementHistory(recording, data, { trailUnitTypes: [] });
  assert.equal(none.segments.length, 0); assert.equal(seconds(none), 10);
  assert.equal(seconds(createMovementHistory(recording, data, { unitTypes: [] })), 0);
  assert.equal(createMovementHistory(recording, data, { unitTypes: ['infantry'], trailUnitTypes: ['cavalry'] }).segments.length, 0);
});

test('changing unit filters refreshes live markers, cached trails and deaths', async () => {
  const { createReplayLayer } = await import('../src/replay-layer.js');
  const { replay: r, data } = await parseBundle(fs.readFileSync(new URL('./fixtures/SYNTHETIC-tactical-demo.replay.json', import.meta.url), 'utf8'));
  let group;
  const viewer = { heightScale: 1, addLayer(value) { group = value; }, draw() {}, onHeightChange() { return () => {}; } };
  const layer = createReplayLayer(viewer, data, r);
  const all = layer.update({ t: 60000, trails: true, heatmap: true });
  const lines = group.children.filter(child => child.isLineSegments);
  const trailCount = () => lines.reduce((sum, line) => sum + line.geometry.drawRange.count, 0);
  const fullTrails = trailCount(), deathCount = group.getObjectByName('bot-deaths').count;
  assert.ok(fullTrails > 0); assert.ok(deathCount > 0);
  assert.equal(layer.update({ trailUnitTypes: [] }), all);
  assert.equal(trailCount(), 0);
  assert.equal(group.getObjectByName('bot-deaths').count, deathCount);
  assert.ok(group.children.find(child => child.geometry?.type === 'PlaneGeometry').instanceColor.array.some(value => value > 0));
  layer.update({ trailUnitTypes: ['cavalry', 'artillery', 'infantry'] });
  assert.equal(trailCount(), fullTrails);
  assert.equal(layer.update({ deathUnitTypes: [] }), all);
  assert.equal(group.getObjectByName('bot-deaths').count, 0);
  assert.equal(trailCount(), fullTrails);
  const { botDeathMarkers } = await import('../src/replay-history.js');
  const deaths = botDeathMarkers(r).filter(row => row.t <= 60000);
  for (const type of ['cavalry', 'artillery', 'infantry']) {
    assert.equal(layer.update({ deathUnitTypes: [type] }), all);
    assert.equal(group.getObjectByName('bot-deaths').count, deaths.filter(row => unitCategory(row) === type).length);
    assert.equal(trailCount(), fullTrails);
  }
  layer.update({ deathUnitTypes: ['cavalry', 'artillery', 'infantry'] });
  assert.equal(group.getObjectByName('bot-deaths').count, deathCount);
  layer.update({ t: r.first });
  assert.equal(group.getObjectByName('bot-deaths').count, 0);
  layer.update({ t: 60000 });
  assert.equal(group.getObjectByName('bot-deaths').count, deathCount);
  let partition = 0;
  for (const type of ['cavalry', 'artillery', 'infantry']) {
    partition += layer.update({ unitTypes: [type] });
    for (const other of ['cavalry', 'artillery', 'infantry'].filter(value => value !== type)) assert.equal(group.getObjectByName(`replay-${other}`).count, 0);
  }
  assert.equal(partition, all);
  assert.equal(layer.update({ unitTypes: [] }), 0);
  assert.equal(trailCount(), 0); assert.equal(group.getObjectByName('bot-deaths').count, 0);
  assert.equal(layer.update({ unitTypes: ['cavalry', 'artillery', 'infantry'] }), all);
  assert.equal(trailCount(), fullTrails); assert.equal(group.getObjectByName('bot-deaths').count, deathCount);
  layer.dispose();
});
