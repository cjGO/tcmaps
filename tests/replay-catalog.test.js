import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { replayCatalog, recordedPlayerCount, recordedPlayerRoster } from '../scripts/replay-catalog.mjs';
import { recordingLabel, filterRecordings, renderReplayCatalog } from '../src/replay-catalog.js';

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

  // Audit every published roster against the raw journal, including all control
  // changes, then check every recorded name can retrieve its own replay.
  for (const recording of catalog) {
    const bundle = JSON.parse(await readFile(new URL('../replays/' + recording.filename, import.meta.url), 'utf8'));
    const expected = new Map();
    for (const row of bundle.journal.trimEnd().split('\n').map(JSON.parse)) {
      if (!['entity', 'change'].includes(row.type)) continue;
      for (const id of [row.owner, row.controller]) {
        if (id !== false) expected.set(id, expected.get(id) ?? new Set());
      }
      if (row.controller && typeof row.player_name === 'string') expected.get(row.controller).add(row.player_name);
    }
    assert.deepEqual(recording.roster, [...expected].sort(([a], [b]) => a - b).map(([id, names]) => ({ id, names: [...names].sort() })), recording.id);
    assert.equal(recording.players, recording.roster.length);
    for (const { names } of recording.roster) for (const name of names) {
      assert.ok(filterRecordings(catalog, 0, name.toUpperCase()).includes(recording), `${recording.id}: ${name}`);
    }
  }
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

test('rosters track aliases and reconnects without assigning controller names to owners', () => {
  const tracks = new Map([
    [1, { changes: [{ owner: 1, controller: 2, player_name: 'Alice' }, { owner: 1, controller: 2, player_name: 'New name' }] }],
    [2, { changes: [{ owner: 2, controller: 2, player_name: 'Alice' }, { owner: false, controller: 3, player_name: 'Alice' }] }],
    [3, { changes: [{ owner: 4, controller: false, player_name: false }] }],
  ]);
  assert.deepEqual(recordedPlayerRoster({ tracks }), [
    { id: 1, names: [] }, { id: 2, names: ['Alice', 'New name'] },
    { id: 3, names: ['Alice'] }, { id: 4, names: [] },
  ]);
});

test('optional name search matches partial names and aliases and combines all names with the count', () => {
  const rows = [
    { players: 2, roster: [{ id: 1, names: ['Marechal_Ney', 'Ａｌｉｃｅ'] }, { id: 2, names: ['7jacin'] }] },
    { players: 1, roster: [{ id: 1, names: ['Marechal_Ney'] }] },
    { players: 30, roster: [{ id: 1, names: [] }] },
    { players: 30 },
  ];
  assert.deepEqual(filterRecordings(rows, 0, '  ,  '), rows);
  assert.deepEqual(filterRecordings(rows, 0, 'nEy'), rows.slice(0, 2));
  assert.deepEqual(filterRecordings(rows, 0, ' nEy, JACIN, '), [rows[0]]);
  assert.deepEqual(filterRecordings(rows, 2, 'ney'), [rows[0]]);
  assert.deepEqual(filterRecordings(rows, 3, 'ney'), []);
  assert.deepEqual(filterRecordings(rows, 0, 'alice'), [rows[0]]);
  assert.deepEqual(filterRecordings(rows, 0, 'Player #1'), []);
  assert.deepEqual(filterRecordings(rows, 0, '.*'), []);
});

test('catalog shows inspectable rosters safely and keeps selection and empty states', () => {
  const dom = new JSDOM('<div id="catalog"></div>');
  const originalDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const container = document.getElementById('catalog');
    const recording = { id: 'round-1', created: '2026-10-27T05:25:01Z', map: 'scn_test', players: 2, bots: 0,
      bots_by_team: [], roster: [{ id: 1, names: ['<img src=x onerror=alert(1)>', 'Alias'] }, { id: 2, names: [] }] };
    let opened;
    assert.equal(renderReplayCatalog(container, [recording], row => { opened = row; }, { selectedId: recording.id, playerNames: 'alias' }), 1);
    assert.equal(container.querySelector('button').getAttribute('aria-pressed'), 'true');
    container.querySelector('button').click();
    assert.equal(opened, recording);
    assert.equal(new URL(container.querySelector('a').href).searchParams.get('replay'), recording.id);
    assert.match(container.querySelector('summary').textContent, /2.*1 without recorded names/);
    assert.match(container.querySelector('details p').textContent, /<img.*Alias.*Player #2 \(name unavailable\)/);
    assert.equal(container.querySelector('img'), null);
    assert.equal(renderReplayCatalog(container, [recording], () => {}, { playerNames: 'missing' }), 0);
    assert.match(container.textContent, /No replays match these filters/);
    renderReplayCatalog(container, [], () => {});
    assert.match(container.textContent, /No published replays/);
  } finally {
    globalThis.document = originalDocument;
    dom.window.close();
  }
});
