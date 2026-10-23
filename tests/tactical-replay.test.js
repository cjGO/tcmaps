import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseJournal, soldierAt, facingBetween, movementHeatmap, matchTerrain, parseBundle } from '../src/tactical-replay.js';

const journal = () => fs.readFileSync(new URL('./fixtures/SYNTHETIC-tactical-demo.jsonl', import.meta.url), 'utf8');
const replay = () => parseJournal(journal());
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
