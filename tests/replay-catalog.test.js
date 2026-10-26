import test from 'node:test';
import assert from 'node:assert/strict';
import { replayCatalog } from '../scripts/replay-catalog.mjs';
import { recordingLabel } from '../src/replay-catalog.js';

test('published recordings use event totals and distinguish manual stops', async () => {
  const rows = await replayCatalog(new URL('../replays/', import.meta.url));
  assert.deepEqual(rows.map(row => row.bots), [74, 95, 25, 5, 46, 91]);
  assert.deepEqual(rows.map(row => row.round), ['1', '1', '3', '2', '1', '3']);
  assert.ok(rows.slice(0, 5).every(row => row.round_ended));
  assert.equal(rows.at(-1).round_ended, false);
  assert.match(recordingLabel(rows.at(-1)), /at recording end/);
  assert.ok(rows.every(row => row.map_id === null));
});

test('labels show permanent identities and zero survivors when available', () => {
  assert.equal(recordingLabel({ map_id: 'test_map_141', map: 'scn_mp_custom_map_3', round: '2', bots: 0, round_ended: true }),
    'Test map #141 - Round #2 - 0 bots remaining at round end');
});
