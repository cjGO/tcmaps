import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExperimentalJournal } from '../src/experimental-replay.js';
import { buildCombatIndex, pathPose, inferredFrame, combatTotalsAt, inferenceCsv } from '../src/replay-v3-model.js';
import { weaponName } from '../src/replay-v3-weapons.js';
import { v3Fixture, finalizeV3, journalV3 } from './fixtures/replay-v3-fixtures.js';
const parse = rows => parseExperimentalJournal(journalV3(finalizeV3(rows)));
const withoutCombat = () => v3Fixture().filter(r => !['shot', 'hit'].includes(r.type));
const shot = (t = 3000, fields = {}) => ({ type: 'shot', t, shooter: 1, weapon: 42, position: [9000, 8000, 230, 0, 0, 0], direction: 'weapon_transform_not_verified_projectile_direction', ...fields });
const hit = (t = 3500, fields = {}) => ({ type: 'hit', t, attacker: 1, victim: 13, weapon: 42, ammo: 117, projectile: false, projectile_shooter: false, position: [9000, 20000, 180, 0, 0, 0], reported_damage: 45, damage_semantics: 'incoming_trigger_value', ...fields });
const index = events => buildCombatIndex(parse([...withoutCombat(), ...events]));

test('v2 journal stays byte-equivalent and its capability claims stay unchanged after inference', () => {
  const replay = parse(v3Fixture()), before = JSON.stringify(replay.records), combat = buildCombatIndex(replay);
  assert.equal(combat.paths.length, 16); assert.equal(combat.stats.shots, 24); assert.equal(combat.stats.unlinkedShots, 8);
  assert.equal(JSON.stringify(replay.records), before); assert.equal(replay.header.capabilities.exact_native_shot_hit_link, false);
  assert.equal(combat.volleys.length, 2); assert.deepEqual(combat.volleys.map(v => v.count), [12, 12]);
});
test('inferred motion reaches the measured hit exactly and never fabricates a trajectory for unpaired shots', () => {
  const combat = index([shot(), hit(), shot(5000)]), path = combat.paths[0];
  assert.deepEqual(pathPose(path, path.t), { x: 90, y: 80, z: 2.3 });
  assert.deepEqual(pathPose(path, path.end), { x: 90, y: 200, z: 1.8 });
  assert.equal(pathPose(path, 3250).y, 140); assert.equal(combat.paths.length, 1); assert.equal(combat.stats.unlinkedShots, 1);
});
test('multiple candidate firings and multiple hits for the same firing stay ambiguous', () => {
  assert.equal(index([shot(), shot(3100), hit()]).paths.length, 0);
  const combat = index([shot(), hit(), hit(3600, { victim: 14 })]);
  assert.equal(combat.paths.length, 0); assert.equal(combat.reasons.multiple_hits_for_shot, 2);
});
test('rejects same-millisecond flight, backwards firing direction, stale shots and implausible velocity', () => {
  for (const events of [[shot(), hit(3000)], [shot(3500), hit(3000)], [shot(), hit(6100)],
    [shot(), hit(3010)], [shot(), hit(3500, { position: [9000, -4000, 180, 0, 0, 0] })]]) assert.equal(index(events).paths.length, 0);
});
test('uses recording-local lifetimes and exact weapons; never substitutes an artillery hit', () => {
  for (const fields of [{ attacker: 2 }, { attacker: false }, { weapon: 38 }, { ammo: -1 }, { projectile_shooter: 1 }]) {
    assert.equal(index([shot(), hit(3500, fields)]).paths.length, 0);
  }
  const rows = withoutCombat().map(r => r.type === 'sample' && r.t > 3100 ? { ...r, p: r.p.filter(p => p[0] !== 1) } : r);
  const combat = buildCombatIndex(parse([...rows, shot(), { type: 'death', t: 3100, id: 1, killer: 13, reason: 'death', position: [9000, 8000, 100, 0, 0, 0] }, hit()]));
  assert.equal(combat.paths.length, 1, 'a shot can arrive after its shooter died');
});
test('close range tolerates origin offsets but still rejects zero displacement', () => {
  assert.equal(index([shot(), hit(3020, { position: [9050, 7970, 210, 0, 0, 0] })]).paths.length, 1);
  assert.equal(index([shot(), hit(3020, { position: shot().position })]).paths.length, 0);
});
test('reverse seeks, same-time sequence order and density limits are deterministic', () => {
  const replay = parse(v3Fixture()), combat = buildCombatIndex(replay), path = combat.paths[0];
  assert.equal(inferredFrame(combat, path.t, path.seq - 1).length, 0);
  assert.equal(inferredFrame(combat, path.t, path.seq).length, 1);
  assert.equal(inferredFrame(combat, path.end, path.hitSeq - 1).find(f => f.path.id === path.id).arrived, false);
  assert.equal(inferredFrame(combat, path.end, path.hitSeq).find(f => f.path.id === path.id).arrived, true);
  const first = inferredFrame(combat, 3350); inferredFrame(combat, 9000); assert.deepEqual(inferredFrame(combat, 3350), first);
  assert.equal(inferredFrame(combat, 3350, Infinity, { density: 2 }).length, 2);
  assert.equal(inferredFrame(combat, 9000).length, 0);
  assert.equal(combatTotalsAt(replay, combat, path.end, path.hitSeq - 1).linkedHits, 0);
  assert.equal(combatTotalsAt(replay, combat, path.end, path.hitSeq).linkedHits, 1);
});
test('shot metadata and filters use identity at firing, including after a takeover', () => {
  const rows = withoutCombat(), intro = rows.find(r => r.type === 'entity' && r.id === 1);
  const replay = parse([...rows, shot(), hit(), { ...intro, type: 'change', t: 4000, kind: 'bot', controller: false, player_name: false }]);
  const combat = buildCombatIndex(replay);
  assert.equal(combat.paths[0].shooterMeta.player_name, 'Synthetic North');
  assert.equal(inferredFrame(combat, 3250, Infinity, { players: false }).length, 0);
  assert.equal(inferredFrame(combat, 3250, Infinity, { soldier: '2' }).length, 0);
});
test('CSV states provenance, and weapon names require the exact recorded build', () => {
  const replay = parse(v3Fixture()), combat = buildCombatIndex(replay);
  assert.match(inferenceCsv(combat), /shot_seq,hit_seq/); assert.match(inferenceCsv(combat), /inferred_from_recorded_shot_and_hit/);
  assert.equal(weaponName(replay, 42), 'Weapon #42');
  replay.header.build.components = { 'item_kinds1.txt': '520ff72c80a2494cf0468b60c3820b9687653bf749bfab3ca57ce42db4d55ba1' };
  assert.equal(weaponName(replay, 42), 'Infantry Musket');
});
test('shipping synthetic demo parses and matches the authored v2 fixture', () => {
  const text = readFileSync(new URL('./fixtures/SYNTHETIC-replay-v3.jsonl', import.meta.url), 'utf8');
  const replay = parseExperimentalJournal(text); assert.equal(replay.header.synthetic, true);
  assert.equal(buildCombatIndex(replay).paths.length, 16);
});
