import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseExperimentalJournal as parse, experimentalPose, entityAt, projectileAt, experimentalFrame, effectsAt, activeProjectiles, eventIndex, terrainCandidate, terrainOverlayCandidate, verifyExperimentalTerrain, neutralReference, EXP_LIMITS } from '../src/experimental-replay.js';
import { parseJournal, sha256 } from '../src/tactical-replay.js';
import { displayedHeight } from '../src/terrain-geometry.js';
import { experimentalFixture, journal, finalize } from './fixtures/experimental-fixtures.js';
const fixture = () => experimentalFixture();
const model = () => parse(journal(fixture()));
const change = fn => { const rows = fixture(); fn(rows); return journal(rows); };

test('real recording counts, exact duration, provenance, missing map and fog sentinel', () => {
  const r = parse(readFileSync(new URL('../experimental_replays/EXP-20261029T074033Z-1.jsonl', import.meta.url), 'utf8'));
  assert.equal(r.duration, 131893); assert.equal(r.tracks.size, 82); assert.equal(r.records.length, 498); assert.equal(r.positions, 1391);
  assert.deepEqual(r.counts, { header: 1, entity: 82, sample: 26, shot: 207, hit: 113, death: 68, end: 1 });
  assert.equal(r.incomplete, false); assert.equal(r.terminal.reason, 'round_end'); assert.equal(r.header.partial_round, true);
  assert.equal(r.header.map.available, false); assert.equal(r.header.fog.distance_m, -1); assert.equal(r.header.synthetic, false);
  assert.equal(r.header.capabilities.exact_native_shot_hit_link, false); assert.equal(r.header.capabilities.native_missiles, 'unverified_disabled');
  assert.ok(r.header.build); assert.equal(terrainCandidate(r, [{ source: r.header.map.source }]), null);
  assert.ok(neutralReference(r).bounds.x_max_m > 100);
});
test('experimental and stable schemas are strictly separate', () => {
  assert.throws(() => parseJournal(journal(fixture())), /Unsupported replay schema/);
  const stable = JSON.parse(readFileSync(new URL('fixtures/SYNTHETIC-tactical-demo.replay.json', import.meta.url), 'utf8'));
  assert.throws(() => parse(stable.journal), /Line 1/);
  assert.throws(() => parse(change(r => { r[0].version = 3; })), /schema\/version/);
  assert.throws(() => parse(change(r => { r[0].rotation_units = 'millidegrees'; })), /header or units/);
});
test('units, native yaw and shortest-angle interpolation; height is never ground clamped', () => {
  assert.deepEqual(experimentalPose([100, 200, 300, 10, 20, 90]), { x: 1, y: 2, z: 3, rx: 10, ry: 20, rz: 90, facing: 270 });
  const r = model(), p = entityAt(r.tracks.get(1), 3500);
  assert.equal(p.x, 8); assert.equal(p.rz, 45); assert.equal(p.facing, 315); assert.equal(p.measured, false);
  assert.equal(displayedHeight(25, 5, 4), 85);
  assert.equal(projectileAt(r.projectiles.get(1), 3000).z, 5.25);
});
test('event order reveals a shot before death at the same millisecond', () => {
  const r = model(), shot = r.byType.shot.at(-1), death = r.byType.death[0];
  assert.ok(shot.seq < death.seq); assert.ok(entityAt(r.tracks.get(1), shot.t, shot.seq));
  assert.equal(entityAt(r.tracks.get(1), death.t, death.seq), null);
  assert.ok(effectsAt(r, death.t).some(x => x.event.seq === shot.seq));
  assert.equal(eventIndex(r.events, shot.t, shot.seq), r.events.indexOf(shot));
});
test('direct seeks match sequential playback, backwards seeks, and layer changes', () => {
  const r = model();
  for (const t of [1000, 3000, 3500, 4000, 4500, 7000, 8000, 11000]) {
    const direct = experimentalFrame(r, t);
    for (let time = r.first; time <= t; time += 137) experimentalFrame(r, time);
    assert.deepEqual(experimentalFrame(r, t), direct);
    experimentalFrame(r, r.last); assert.deepEqual(experimentalFrame(r, t), direct);
  }
  assert.equal(experimentalFrame(r, 4500, Infinity, { artillery: false }).projectiles.length, 0);
  assert.equal(experimentalFrame(r, 6000).effects.filter(x => x.family === 'shots').length, 0);
});
test('entity and engine prop reuse preserve dead-shooter attribution', () => {
  const r = model();
  assert.equal(entityAt(r.tracks.get(1), 7500), null); assert.ok(entityAt(r.tracks.get(4), 7500));
  const hit = r.byType.hit.at(-1); assert.equal(hit.attacker, 4); assert.equal(hit.projectile_shooter, 1);
  assert.equal(r.projectiles.get(2).meta.shooter, 1); assert.equal(r.projectiles.get(1).meta.instance, r.projectiles.get(2).meta.instance);
  assert.equal(projectileAt(r.projectiles.get(1), 8000), null); assert.ok(projectileAt(r.projectiles.get(2), 8000));
});
test('damage overrides remain separate original records without health fields', () => {
  const r = model(), hit = r.byType.hit[0];
  assert.equal(hit.reported_damage, 75); assert.equal(r.overrides.get(hit.seq)[0].value, 20);
  assert.equal(hit.health, undefined); assert.equal(r.tracks.get(2).health, undefined);
  assert.equal(experimentalFrame(r, 3000).entities.find(p => p.id === 2).health, undefined);
});
test('horses are explicit; stable metadata is not fabricated', () => {
  const r = model(), frame = experimentalFrame(r, 1000);
  assert.equal(frame.entities.filter(e => e.kind === 'horse').length, 1);
  assert.equal(frame.entities.filter(e => e.kind !== 'horse').length, 2);
  assert.equal(frame.entities[0].horse, 3);
  for (const key of ['class', 'owner', 'player_name']) assert.equal(r.tracks.get(1).meta[key], undefined);
});
test('projectile commands use centiseconds and restart at evaluated interruption; bounce is measured', () => {
  const r = model(), track = r.projectiles.get(1);
  assert.equal(projectileAt(track, 3500).x, 10.5); assert.equal(projectileAt(track, 3500).z, 6.875);
  assert.equal(projectileAt(track, 3750).x, 11.0625);
  assert.equal(projectileAt(track, 4000).x, 10); assert.equal(projectileAt(track, 4000).z, .2);
  assert.equal(projectileAt(track, 4250).x, 10.625);
  assert.equal(projectileAt(track, 4500), null); assert.equal(track.end.reason, 5);
  assert.equal(projectileAt(r.projectiles.get(2), 8000).z, 20); // zero-duration command
  assert.ok(effectsAt(r, 4500).some(x => x.event.type === 'explosion' && x.event.radius_cm === 1000));
});
test('fragments retain parents with no invented trajectory; midflight contact stands alone', () => {
  const r = model(); assert.equal(r.projectiles.size, 2);
  const fragments = r.byType.fragment_launch; assert.equal(r.records[fragments[0].parent - 1].type, 'explosion'); assert.equal(r.records[fragments[1].parent - 1].type, 'artillery_fire');
  assert.equal(fragments[0].trajectory, undefined); assert.equal(r.byType.water_contact[0].projectile, false);
  assert.ok(effectsAt(r, 4500).some(e => e.event.type === 'water_contact'));
});
test('terrain requires hashes, version and recorded variant; manual overlay stays unverified', async () => {
  const r = model(), source = { sco_sha256: 'a'.repeat(64), recipe_sha256: 'b'.repeat(64), terrain_code: '0x' + '0'.repeat(48) };
  const entry = { source, map_id: 'test_map_1', variant_id: 'VarA', variant_revision: 'r1' };
  const data = { ...neutralReference(r), source, schema_version: 1, height_data_sha256: 'c'.repeat(64), spawns: [{ x_m: 0, y_m: 0, z_m: 0 }, { x_m: 10, y_m: 10, z_m: 0 }] };
  const original = structuredClone(r.header.map);
  assert.equal((await verifyExperimentalTerrain(r, data, entry, true)).verified, false); assert.deepEqual(r.header.map, original);
  await assert.rejects(verifyExperimentalTerrain(r, data, entry), /version mismatch/);
  r.header.map = { ...original, available: true, ...entry, version: await sha256(`${source.sco_sha256}:${source.recipe_sha256}`) };
  assert.equal(terrainCandidate(r, [entry]), entry); assert.equal((await verifyExperimentalTerrain(r, data, entry)).verified, true);
  delete r.header.map.available; delete r.header.map.scene;
  r.header.map.kind = 'fixed'; r.header.map.id = 'scn_mp_custom_map_1';
  assert.equal(terrainCandidate(r, [entry]), entry); // Actual frozen replay_maps.lua format.
  const rows = fixture(); rows[0].map = r.header.map;
  assert.equal(parse(journal(rows)).header.map.available, undefined);
  assert.equal(terrainCandidate(r, [{ ...entry, variant_revision: 'r2' }]), null);
  r.header.map.version = 'd'.repeat(64); await assert.rejects(verifyExperimentalTerrain(r, data, entry), /version mismatch/);
});
test('bundled recordings resolve available test maps without claiming exact historical terrain', async () => {
  const directory = new URL('../experimental_replays/', import.meta.url);
  const { maps } = JSON.parse(readFileSync(new URL('../lib/rotation-topology.json', import.meta.url), 'utf8'));
  const matched = new Set();
  for (const filename of readdirSync(directory).filter(name => name.startsWith('EXP-') && name.endsWith('.jsonl'))) {
    const replay = { header: JSON.parse(readFileSync(new URL(filename, directory), 'utf8').split('\n')[0]) };
    const original = structuredClone(replay.header.map);
    const candidate = terrainOverlayCandidate(replay, maps);
    if (replay.header.map.available === false) { assert.equal(candidate, null); continue; }
    assert.ok(candidate, filename);
    assert.equal(candidate.map_id, replay.header.map.map_id);
    assert.equal(terrainCandidate(replay, maps), null, 'Current assets differ from recorded sources');
    const text = readFileSync(new URL('../public' + candidate.url, import.meta.url), 'utf8');
    assert.equal(await sha256(text), candidate.sha256);
    const data = JSON.parse(text), result = await verifyExperimentalTerrain(replay, data, candidate, 'map-id');
    assert.equal(result.verified, false);
    assert.match(result.label, /matched test map automatically; recorded version differs/);
    await assert.rejects(verifyExperimentalTerrain(replay, data, candidate), /version mismatch/);
    assert.deepEqual(replay.header.map, original);
    matched.add(candidate.map_id);
  }
  assert.ok(matched.size > 0, 'At least one bundled recording has an available test map');
});
test('automatic overlays reject missing identities, scene-slot guesses and ambiguous or different variants', () => {
  const entry = { id: 'scn_mp_custom_map_1', map_id: 'test_map_107', variant_id: 'source', variant_revision: '' };
  const replay = { header: { map: { ...entry, kind: 'fixed' } } };
  assert.equal(terrainOverlayCandidate(replay, [entry]), entry);
  for (const patch of [{ available: false }, { kind: 'generated' }, { map_id: false }, { map_id: 'test_map_999' }, { variant_id: 'VarA' }, { variant_revision: 'r2' }]) {
    assert.equal(terrainOverlayCandidate({ header: { map: { ...replay.header.map, ...patch } } }, [entry]), null);
  }
  assert.equal(terrainOverlayCandidate(replay, [entry, { ...entry }]), null);
  const noVariant = { header: { map: { ...entry, variant_id: false, variant_revision: false } } };
  assert.equal(terrainOverlayCandidate(noVariant, [entry, { ...entry, variant_id: 'VarA' }]), null);
});
test('torn final line and absent terminal are explicitly incomplete; interior corruption is fatal', () => {
  const rows = fixture(); rows.pop();
  let r = parse(journal(rows)); assert.equal(r.incomplete, true); assert.match(r.warnings.join(' '), /Incomplete/);
  r = parse(journal(rows) + '{"type":'); assert.equal(r.truncated, true); assert.equal(r.incomplete, true);
  r = parse(journal(fixture()) + '{'); assert.equal(r.incomplete, true);
  assert.throws(() => parse(journal(rows).replace('\n', '\n{broken}\n')), /Line 2: Malformed/);
  assert.throws(() => parse(journal(fixture()) + '{}\n'), /Line .*Unknown|Record after/);
});
test('malformed references, counts, types, sequences and lifetime boundaries fail with line diagnostics', () => {
  const edits = [
    r => { r[1].id = '1'; }, r => { r[2].id = 1; }, r => { r[2].engine_agent = 1; }, r => { r[2].t = 0; }, r => { r[2].seq++; },
    r => { r.find(r => r.type === 'shot').shooter = 999; }, r => { r.find(r => r.type === 'shot').position[0] = '1'; },
    r => { r.find(r => r.type === 'sample').p[0][1].pop(); }, r => { r.find(r => r.type === 'sample').p[0][0] = 999; },
    r => { r.find(r => r.type === 'sample').p.push(r.find(r => r.type === 'sample').p[0]); },
    r => { r.find(r => r.type === 'projectile_segment').projectile = 88; }, r => { r.find(r => r.type === 'projectile_segment').instance = 99; },
    r => { r.find(r => r.type === 'fragment_launch').parent = 2; }, r => { r.find(r => r.type === 'damage_override').hit = 2; },
    r => { r.find(r => r.type === 'death').id = 99; }, r => { r.at(-1).counts.shot++; }, r => { r.at(-1).positions++; },
    r => { r.find(r => r.type === 'hit').reported_damage = null; }, r => { r[0].capabilities = []; }, r => { r[0].map.kind = 7; },
  ];
  for (const edit of edits) assert.throws(() => parse(change(edit)), /Line \d+:/);
  assert.throws(() => parse(change(r => { r.find(r => r.type === 'shot').position[0] = 1e100; })), /transform/);
  const r = fixture(), death = r.find(e => e.type === 'death');
  r.splice(r.length - 1, 0, { type: 'sample', t: 10000, p: [[death.id, [0, 0, 0, 0, 0, 0], -1]] });
  assert.throws(() => parse(journal(finalize(r))), /outside entity lifetime/);
});
test('file/line/entity/record limits are ceilings and effects are bounded without losing events', () => {
  assert.throws(() => parse(' '.repeat(EXP_LIMITS.bytes + 1)), /64 MiB/);
  assert.throws(() => parse(journal(fixture()).replace('\n', ' '.repeat(EXP_LIMITS.line) + '\n')), /1 MiB/);
  assert.throws(() => parse(journal(experimentalFixture({ soldiers: 4096 }))), /entity limit/);
  const r = parse(journal(experimentalFixture({ soldiers: 600, burst: 800 })));
  assert.equal(r.tracks.size, 602); assert.equal(r.byType.fragment_launch.length, 801);
  assert.equal(effectsAt(r, 4500).filter(x => x.family === 'fragments').length, 512);
  assert.equal(activeProjectiles(r, 3000).length, 512);
  assert.equal(experimentalFrame(r, 3000, Infinity, {}, 64).projectiles.length, 64);
  assert.equal(r.byType.projectile_launch.length, 801);
  assert.equal(effectsAt(r, 4500, Infinity, { fragments: false }).filter(x => x.family === 'fragments').length, 0);
});
test('record-count limit is enforced independently of bytes and movement rows', () => {
  const lines = [JSON.stringify(fixture()[0])];
  for (let seq = 2; seq <= EXP_LIMITS.records + 1; seq++) lines.push(JSON.stringify({ type: 'sample', t: 1000, seq, p: [] }));
  assert.throws(() => parse(lines.join('\n') + '\n'), /Line 250001: Record limit exceeded/);
});
test('probe-only source events do not manufacture native bullet tracks or capability claims', () => {
  const rows = fixture(); rows.pop();
  rows.push({ type: 'native_missile_probe', t: 10000, shooter: 1, launcher: 20, ammo: 30, missile: 99 });
  rows.push({ type: 'native_impact_probe', t: 10000, shooter: 1, collision: 1, position: [100, 200, 300, 0, 0, 0] });
  const r = parse(journal(finalize(rows)));
  assert.equal(r.projectiles.size, 2); assert.equal(r.byType.native_missile_probe.length, 1);
  assert.equal(r.header.capabilities.exact_native_shot_hit_link, false);
  assert.equal(r.header.capabilities.native_missiles, 'unverified_disabled');
  assert.ok(effectsAt(r, 10000).some(e => e.event.type === 'native_impact_probe'));
});

// Experimental display parity must not change raw records or the stable parser.
const presentation = await import('../src/experimental-replay-presentation.js');
test('display metadata is recording/build scoped, validated and separate from original events', () => {
  const r = model(), before = JSON.stringify(r.records), m = presentation.metadataTemplate(r);
  m.entities[2] = { player_name: '<Player & Name>', squad: 'Blue' };
  m.troops[102] = { unit_category: 'artillery' };
  const parsed = presentation.parseDisplayMetadata(JSON.stringify(m), r);
  assert.equal(presentation.displayMeta(r.tracks.get(2), null, parsed).label, '<Player & Name>');
  assert.equal(presentation.displayMeta(r.tracks.get(2), null, parsed).unit_category, 'artillery');
  assert.equal(JSON.stringify(r.records), before);
  for (const edit of [m => m.recording_id = 'another', m => m.build_id = 'other', m => m.entities[9999] = {}, m => m.entities[1] = { player_name: 'bot' }, m => m.troops[102].unit_category = 'tank', m => m.entities[2].player_name = 'x'.repeat(129), m => m.entities[2].health = 100]) {
    const bad = structuredClone(m); edit(bad); assert.throws(() => presentation.parseDisplayMetadata(JSON.stringify(bad), r));
  }
  assert.equal(presentation.displayMeta(r.tracks.get(2)).label, 'Player #2');
  assert.equal(presentation.displayMeta(r.tracks.get(2)).unit_category, 'unknown');
  assert.equal(presentation.displayMeta(r.tracks.get(1), { horse: 3 }).unit_category, 'cavalry');
});
test('full trails survive deaths and rewinds, split gaps, and honor display filters', () => {
  const r = model(), data = neutralReference(r), h = presentation.experimentalHistory(r, data);
  assert.ok(h.segments.some(s => s.id === 1 && s.t === 7000));
  const final = h.completed(r.last); assert.ok(final > 0); assert.equal(h.completed(r.first), 0);
  assert.equal(h.completed(r.last), final); assert.equal(h.partial(3500).find(s => s.id === 1).to.x, 8);
  const bots = presentation.experimentalHistory(r, data, null, { players: false }); assert.ok(bots.segments.every(s => s.id !== 2));
  const cavalry = presentation.experimentalHistory(r, data, null, { trailUnitTypes: ['cavalry'] }); assert.ok(cavalry.segments.length > 0); assert.ok(cavalry.segments.every(s => s.id === 1));
  const track = r.tracks.get(2); track.samples[1].snapshot += 10;
  const gaps = presentation.experimentalHistory(r, data); assert.ok(gaps.segments.every(s => s.id !== 2));
});
test('death crosses persist at measured locations with exact same-time sequence and unit filters', () => {
  const r = model(), deaths = presentation.experimentalDeaths(r), event = r.byType.death[0], marker = deaths[0];
  assert.equal(deaths.length, 1); assert.equal(marker.x, 15); assert.equal(marker.unit_category, 'cavalry');
  assert.equal(eventIndex(deaths, event.t, event.seq - 1), -1); assert.equal(eventIndex(deaths, r.last), 0);
  assert.equal(presentation.matchesDisplay(marker, { bots: false }), false);
  assert.equal(presentation.matchesDisplay(marker, { deathUnitTypes: ['infantry'] }, ['infantry']), false);
  assert.equal(presentation.experimentalStrengthAt(r, event.t, event.seq - 1).get(1), 1);
  assert.equal(presentation.experimentalStrengthAt(r, event.t, event.seq).get(1), 0);
});
test('follow seeks use recorded poses and heatmap counts only supported movement intervals', () => {
  const r = model(), track = r.tracks.get(1);
  assert.equal(presentation.experimentalViewAt(track, 999), null);
  assert.equal(presentation.experimentalViewAt(track, 3500).x, 8);
  assert.equal(presentation.experimentalViewAt(track, 9000).x, 15);
  assert.equal(presentation.experimentalViewAt(track, 9000).ended, true);
  assert.equal(presentation.experimentalViewAt(track, 3500).ended, false);
  const h = presentation.experimentalHistory(r, neutralReference(r));
  assert.equal(h.heatAt(r.first).reduce((a, b) => a + b, 0), 0);
  assert.ok(Math.abs(h.heatAt(r.last).reduce((a, b) => a + b, 0) - 11) < .001);
});

test('experimental GPU layer renders shapes, persistent deaths, full history and disposes without changing stable code', async () => {
  const { createExperimentalLayer } = await import('../src/experimental-replay-layer.js');
  const r = model(), metadata = presentation.metadataTemplate(r); metadata.troops[102] = { unit_category: 'artillery' }; metadata.troops[123] = { unit_category: 'infantry' };
  let group, heightChanged;
  const viewer = { canvas: new EventTarget(), heightScale: 1, draw() {}, addLayer(g) { group = g; }, onHeightChange(fn) { heightChanged = fn; return () => {}; } };
  const layer = createExperimentalLayer(viewer, neutralReference(r), r, { reference: true, metadata });
  let stats = layer.update({ t: 3000, layers: { trails: true }, playerNames: false });
  assert.equal(stats.unitCounts.cavalry, 1); assert.equal(stats.unitCounts.artillery, 1); assert.equal(stats.horses, 1); assert.equal(stats.projectiles, 1); assert.ok(stats.effects > 0);
  assert.equal(group.getObjectByName('experimental-players').count, 1);
  stats = layer.update({ t: 8000 }); assert.equal(stats.unitCounts.infantry, 1); assert.equal(stats.botDeaths, 1); assert.ok(stats.trailSegments > 0);
  const finalCount = stats.trailSegments;
  layer.update({ t: 1000 }); assert.equal(group.getObjectByName('experimental-bot-deaths').count, 0);
  assert.equal(layer.update({ t: 8000 }).trailSegments, finalCount);
  stats = layer.update({ bots: false }); assert.equal(stats.botDeaths, 0); assert.equal(stats.unitCounts.infantry, 0);
  stats = layer.update({ bots: true, unitTypes: ['artillery'] }); assert.equal(stats.unitCounts.infantry, 0);
  viewer.heightScale = 4; heightChanged();
  assert.ok(layer.heatmap().some(cell => cell.soldier_seconds > 0));
  layer.dispose();
});
test('unpositioned births still count toward bot strength; missing death positions use last sample only', () => {
  const r = model(), track = r.tracks.get(1); track.samples = []; track.meta.position = false;
  const adapter = presentation.movementAdapter(r); assert.equal(adapter.tracks.get(1).changes[0].t, track.birth.t);
  const event = r.byType.death[0]; event.position = false; assert.equal(presentation.experimentalDeaths(r).length, 0);
});

test('declared troop roles require the recorded scripts hash and never provide player identities', () => {
  const r = parse(readFileSync(new URL('../experimental_replays/EXP-20261029T074033Z-1.jsonl', import.meta.url), 'utf8'));
  let metadata = presentation.resolveDisplayMetadata(r);
  assert.equal(metadata.buildMatched, true);
  for (const track of r.tracks.values()) assert.equal(presentation.displayMeta(track, null, metadata).unit_category, 'infantry');
  const player = [...r.tracks.values()].find(t => t.meta.kind === 'player');
  assert.equal(presentation.displayMeta(player, null, metadata).player_name, '');
  assert.equal(metadata.declaredRoles[20], 'artillery'); assert.equal(metadata.declaredRoles[136], 'artillery'); assert.equal(metadata.declaredRoles[49], 'infantry'); assert.equal(metadata.declaredRoles[13], 'cavalry');
  const override = { troops: { [player.meta.troop]: { unit_category: 'unknown' } } };
  assert.equal(presentation.displayMeta(player, null, presentation.resolveDisplayMetadata(r, override)).unit_category, 'unknown');
  r.header.build.components['scripts.txt'] = '0'.repeat(64);
  metadata = presentation.resolveDisplayMetadata(r); assert.equal(metadata.buildMatched, false);
  assert.equal(presentation.displayMeta(player, null, metadata).unit_category, 'unknown');
});
