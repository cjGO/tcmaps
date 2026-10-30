import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
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
    if (recording.version !== 1) continue;
    const content = await readFile(new URL('../replays/' + recording.filename, import.meta.url), 'utf8');
    const journal = recording.filename.endsWith('.jsonl') ? content : JSON.parse(content).journal;
    const expected = new Map();
    for (const row of journal.trimEnd().split('\n').map(JSON.parse)) {
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
    'v1 · Test map #141 - Round #2 - 12 players recorded - 0 bots remaining at round end');
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

test('combined catalog interleaves v1 and v2 with shared player filters and links', async () => {
  const { combinedReplayCatalog } = await import('../scripts/replay-catalog.mjs');
  const rows = await combinedReplayCatalog(new URL('../replays/', import.meta.url));
  assert.deepEqual([...new Set(rows.map(row => row.version))].sort(), [1, 2]);
  for (let i = 1; i < rows.length; i++) assert.ok(Date.parse(rows[i - 1].created) >= Date.parse(rows[i].created));
  const v2 = rows.find(row => row.version === 2 && row.roster.some(player => player.names.length));
  assert.ok(v2.url.startsWith('experimental_replays/'));
  assert.match(recordingLabel(v2), /^v2 · /);
  assert.equal(v2.players, v2.roster.length);
  const name = v2.roster.find(player => player.names.length).names[0];
  assert.ok(filterRecordings(rows, v2.players, name).includes(v2));
  assert.ok(!filterRecordings(rows, v2.players + 1, name).includes(v2));
});


test('JSONL recordings in replays are cataloged and emitted without conversion', async () => {
  const { replaysPlugin } = await import('../scripts/replay-catalog.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'replay-jsonl-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(directory, 'replays'));
    const bundleText = await readFile(new URL('./fixtures/SYNTHETIC-tactical-demo.replay.json', import.meta.url), 'utf8');
    const bundle = JSON.parse(bundleText);
    const experimental = await readFile(new URL('./fixtures/SYNTHETIC-experimental-artillery.jsonl', import.meta.url), 'utf8');
    await writeFile(join(directory, 'replays/raw.jsonl'), bundle.journal);
    await writeFile(join(directory, 'replays/bundled.replay.json'), bundleText);
    await writeFile(join(directory, 'replays/experimental.jsonl'), experimental);
    const rows = await replayCatalog(pathToFileURL(join(directory, 'replays/')));
    const raw = rows.find(row => row.filename === 'raw.jsonl');
    const bundled = rows.find(row => row.filename === 'bundled.replay.json');
    assert.deepEqual({ ...raw, filename: bundled.filename, url: bundled.url }, bundled);
    assert.equal(raw.url, 'replays/raw.jsonl');
    const exp = rows.find(row => row.filename === 'experimental.jsonl');
    assert.equal(exp.version, 2);
    assert.equal(exp.url, 'replays/experimental.jsonl');
    const plugin = replaysPlugin();
    plugin.configResolved({ root: directory });
    const module = await plugin.load('\0virtual:replays');
    assert.match(module, /replays\/raw.jsonl/);
    const assets = [];
    await plugin.generateBundle.call({ emitFile(asset) { assets.push(asset); } });
    assert.equal(assets.find(asset => asset.fileName === raw.url).source.toString(), bundle.journal);
    assert.equal(assets.find(asset => asset.fileName === exp.url).source.toString(), experimental);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('raw v1 catalog keeps the recorded test map identity when terrain hashes differ', async () => {
  const catalog = await replayCatalog(new URL('../replays/', import.meta.url));
  const rows = catalog.filter(row => row.version === 1 && row.filename.endsWith('.jsonl'));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const journal = await readFile(new URL('../replays/' + row.filename, import.meta.url), 'utf8');
    const header = JSON.parse(journal.split('\n', 1)[0]);
    assert.equal(row.map_id, header.map.map_id, row.id);
    assert.ok(recordingLabel(row).includes(header.map.map_id.replace('test_map_', 'Test map #')));
  }
});
