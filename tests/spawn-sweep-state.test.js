import test from 'node:test';
import assert from 'node:assert/strict';
import { mapKey, spawnCoordinates, parseSweep, sweepBackup, sweepProgress, coordinatesCSV } from '../src/spawn-sweep-state.js';
const record = () => ({ map_id: 'test_map_107', projectSha256: 'a'.repeat(64), reviewed: false,
  bounds: { x_min_m: 0, x_max_m: 100, y_min_m: 0, y_max_m: 100 },
  defaults: [{ team: 0, entry: 0, x_m: 10, y_m: 50 }, { team: 1, entry: 32, x_m: 90, y_m: 50 }],
  spawns: [{ team: 0, entry: 0, x_m: 25.125, y_m: 50 }, { team: 1, entry: 32, x_m: 90, y_m: 50 }] });
test('saved edits round-trip across maps; source revisions cannot inherit stale edits', () => {
  const a = record(), b = { ...record(), map_id: 'test_map_108' };
  const records = { [mapKey(a)]: a, [mapKey(b)]: b };
  assert.deepEqual(parseSweep(sweepBackup(records)), records);
  assert.equal(records[mapKey({ ...a, projectSha256: 'b'.repeat(64) })], undefined);
});
test('edited and reviewed counts are independent; undo to defaults removes a map from export', () => {
  const a = record(), b = { ...record(), map_id: 'test_map_108', reviewed: true };
  b.spawns = b.defaults;
  const records = { [mapKey(a)]: a, [mapKey(b)]: b };
  assert.deepEqual(sweepProgress([a, b], records), { total: 2, edited: 1, unedited: 1, reviewed: 1 });
  const csv = coordinatesCSV([a,b], records);
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.match(csv, /"test_map_107","1","0","25.125","50"/);
  assert.match(csv, /"test_map_107","2","32","90","50"/);
  assert.doesNotMatch(csv, /test_map_108/);
  a.spawns = a.defaults;
  assert.equal(sweepProgress([a,b], records).edited, 0);
});
test('restore rejects corrupt, duplicate, overlapping and out-of-bounds spawns', () => {
  for (const mutate of [r => r.spawns[0].x_m = NaN, r => r.spawns[0].x_m = -1, r => r.spawns[1].entry = 0, r => r.spawns[0].x_m = 90]) {
    const r = record(); mutate(r);
    assert.throws(() => parseSweep(sweepBackup({ r })));
  }
  assert.throws(() => parseSweep(JSON.stringify({ version: 2, maps: [record(), record()] })));
  assert.deepEqual(spawnCoordinates([{ team: 0, entry: 0, x_m: 12.12345, y_m: 50, z_m: 10 }]), [{ team: 0, entry: 0, x_m: 12.123, y_m: 50 }]);
});
