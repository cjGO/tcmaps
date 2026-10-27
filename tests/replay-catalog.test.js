import test from 'node:test';
import assert from 'node:assert/strict';
import { replayCatalog, recordedPlayerCount } from '../scripts/replay-catalog.mjs';
import { recordingLabel, filterRecordings } from '../src/replay-catalog.js';

test('published recordings use event totals and distinguish manual stops', async () => {
  const catalog = await replayCatalog(new URL('../replays/', import.meta.url));
  assert.ok(catalog.every(row => Number.isSafeInteger(row.players) && row.players >= 0));
  const ids = new Set(['20261026T170833Z-17-1-5', '20261026T170203Z-16-1-4', '20261026T164728Z-15-3-3', '20261026T163627Z-15-2-2', '20261026T162731Z-15-1-1', '20261024T191232Z-27-3-2']);
  const rows = catalog.filter(row => ids.has(row.id));
  assert.deepEqual(rows.map(row => row.bots), [74, 95, 25, 5, 46, 91]);
  assert.deepEqual(rows.map(row => row.round), ['1', '1', '3', '2', '1', '3']);
  assert.ok(rows.slice(0, 5).every(row => row.round_ended));
  assert.equal(rows.at(-1).round_ended, false);
  assert.match(recordingLabel(rows.at(-1)), /at recording end/);
  assert.ok(rows.every(row => row.map_id === null));
});

test('labels show permanent identities and zero survivors when available', () => {
  assert.equal(recordingLabel({ map_id: 'test_map_141', map: 'scn_mp_custom_map_3', round: '2', players: 12, bots: 0, round_ended: true }),
    'Test map #141 - Round #2 - 12 players recorded - 0 bots remaining at round end');
});

test('player totals deduplicate commanders, respawns and control changes', () => {
  const tracks = new Map([
    [1, { changes: [{ owner: 1, controller: false }, { owner: 1, controller: 2 }] }],
    [2, { changes: [{ owner: 1, controller: 1 }, { owner: false, controller: 3 }] }],
    [3, { changes: [{ owner: false, controller: false }] }],
  ]);
  assert.equal(recordedPlayerCount({ tracks }), 3);
  assert.equal(recordedPlayerCount({ tracks: new Map() }), 0);
});

test('minimum player filter includes the boundary and preserves chronology', () => {
  const rows = [{ players: 30 }, { players: 0 }, { players: 15 }, { players: 31 }, { players: 14 }];
  assert.deepEqual(filterRecordings(rows, 0), rows);
  assert.deepEqual(filterRecordings(rows, 15), [rows[0], rows[2], rows[3]]);
  assert.deepEqual(filterRecordings(rows, 30), [rows[0], rows[3]]);
  assert.deepEqual(filterRecordings([{ players: 29 }], 30), []);
});
