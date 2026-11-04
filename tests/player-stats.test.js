import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlayerStats, playerStatsPlugin } from '../scripts/player-stats.mjs';
import { COUNTERS, emptyTotals, metricValue, periodPlayers, filterPlayers, rankPlayers, median, winInterval, dailyTotals, leaderboardCsv } from '../src/player-stats.js';

const totals = values => ({ ...emptyTotals(), ...values });
const compact = values => COUNTERS.map(key => values[key] || 0);
const player = (id, values, extra = {}) => ({ id, order: Number(id), name: 'Player ' + id, aliases: [], totals: totals(values), ...extra });

test('ratios include bots and draws, and never turn a zero denominator into zero or infinity', () => {
  const p = player('1', { personal_kills: 20, personal_human_kills: 5, personal_bot_kills: 15, deaths: 4, squad_kills: 60, squad_casualties: 30, rounds: 10, wins: 5, losses: 3, draws: 2 });
  assert.equal(metricValue(p, 'personal_kd'), 5);
  assert.equal(metricValue(p, 'squad_kd'), 2);
  assert.equal(metricValue(p, 'win_rate'), 50);
  assert.equal(metricValue(p, 'squad_per_round'), 6);
  for (const k of ['personal_kd', 'squad_kd', 'win_rate', 'personal_per_round']) assert.equal(metricValue(player('2', {}), k), null);
});

test('period filters are inclusive, retain all-time totals, and apply before qualification', () => {
  const data = { players: [{ id: 'a', name: 'New name', aliases: ['Old name'], order: 0, totals: compact({ rounds: 30, personal_kills: 40 }), days: [
    ['2026-10-01', compact({ rounds: 25, personal_kills: 30 })], ['2026-10-02', compact({ rounds: 5, personal_kills: 10 })],
  ] }] };
  assert.equal(periodPlayers(data)[0].totals.rounds, 30);
  const period = periodPlayers(data, '2026-10-02', '2026-10-02');
  assert.equal(period[0].totals.personal_kills, 10);
  assert.equal(filterPlayers(period, { minRounds: 20 }).length, 0);
  assert.equal(filterPlayers(period, { search: ' OLD ' }).length, 1);
  assert.equal(periodPlayers(data, '2026-10-03')[0].totals.rounds, 0);
  const days = dailyTotals(period, ['2026-10-01', '2026-10-02'], '2026-10-02');
  assert.deepEqual(days.map(d => d.totals.personal_kills), [10]);
});

test('sorts both ways with undefined values last and stable numeric account ties', () => {
  const players = [player('10', { personal_kills: 6, deaths: 2 }), player('2', { personal_kills: 3, deaths: 1 }), player('1', {})];
  for (const direction of ['asc', 'desc']) assert.deepEqual(rankPlayers(players, 'personal_kd', direction).map(p => p.id), ['2', '10', '1']);
  assert.equal(median([null, 1, 9, 2, 4]), 3);
  assert.equal(median([null]), null);
});

test('Wilson bounds reflect sample size, including all wins and no wins', () => {
  assert.equal(winInterval(0, 0), null);
  const small = winInterval(5, 10), large = winInterval(50, 100);
  assert.ok(small[0] < large[0] && small[1] > large[1]);
  assert.ok(Math.abs(large[0] - 40.383) < .01);
  assert.ok(winInterval(0, 10)[0] >= 0);
  assert.ok(winInterval(10, 10)[1] <= 100);
});

test('CSV quotes names and neutralizes spreadsheet formulas, with raw ratios and blank undefined cells', () => {
  const csv = leaderboardCsv([player('1', {}, { name: '=HYPERLINK("bad")' })]);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(!csv.includes('Infinity') && !csv.includes('NaN'));
  assert.ok(csv.endsWith(',,,,,'));
});

async function fixture(t, { snapshot = true, previous = false, gap = false, mismatch = false, missingJournal = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'player-stats-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'events')); await mkdir(join(dir, 'snapshots'));
  const uid = '90071992547409931';
  const events = [
    { version: 1, seq: 1, at: Date.parse('2026-10-01T23:59:59Z') / 1000, kind: 'kill', changes: { [uid]: { name: 'Before', delta: { personal_kills: 1, personal_bot_kills: 1 } } } },
    { version: 1, seq: gap ? 3 : 2, at: Date.parse('2026-10-02T00:00:01Z') / 1000, kind: 'round_result', changes: { [uid]: { name: 'After', delta: { rounds: 1, wins: 1 } }, '2': { name: 'Other', delta: { rounds: 1, losses: 1 } } } },
  ];
  await writeFile(join(dir, 'events/index.jsonl'), JSON.stringify({ day: '2026-10-02', version: 1 }));
  if (!missingJournal) await writeFile(join(dir, 'events/2026-10-02.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
  await writeFile(join(dir, 'events/2026-09-01.jsonl'), 'unindexed and deliberately invalid');
  if (snapshot) {
    const value = { version: 1, seq: 1, day: '2026-10-02', players: { [uid]: { name: 'Before', totals: totals({ personal_kills: mismatch ? 9 : 1, personal_bot_kills: 1 }) } } };
    await writeFile(join(dir, 'snapshots/' + (previous ? 'previous' : 'current') + '.json'), JSON.stringify(value));
    if (previous) await writeFile(join(dir, 'snapshots/current.json'), '{broken');
  }
  return { dir, uid };
}

test('indexed journal reconciles snapshot, applies tail once, uses event UTC dates, and ignores unindexed files', async t => {
  const { dir, uid } = await fixture(t);
  const d = await loadPlayerStats(dir);
  assert.equal(d.meta.historyValid, true); assert.equal(d.meta.seq, 2); assert.equal(d.meta.ignoredFiles, 1);
  assert.deepEqual(d.meta.days, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(d.players.map(p => p.name), ['Other', 'After']);
  const p = periodPlayers(d)[1];
  assert.equal(p.totals.personal_kills, 1); assert.equal(p.totals.wins, 1);
  assert.deepEqual(p.aliases, ['Before']);
  assert.equal(periodPlayers(d, '2026-10-02')[1].totals.personal_kills, 0);
  assert.ok(!JSON.stringify(d).includes(uid));
});

test('sequence gaps and reconciliation failures fall back to snapshot without publishing partial history', async t => {
  for (const options of [{ gap: true }, { mismatch: true }, { missingJournal: true }]) {
    const { dir } = await fixture(t, options); const d = await loadPlayerStats(dir);
    assert.equal(d.meta.historyValid, false); assert.equal(d.meta.seq, 1); assert.equal(d.players.length, 1);
    assert.deepEqual(d.players[0].days, []); assert.equal(d.meta.notes.length, 1);
  }
});

test('previous snapshot recovery, complete journal without snapshot, and absent data are explicit', async t => {
  const { dir } = await fixture(t, { previous: true });
  const recovered = await loadPlayerStats(dir); assert.equal(recovered.meta.historyValid, true); assert.ok(recovered.meta.notes.some(n => n.includes('recovered')));
  const { dir: journal } = await fixture(t, { snapshot: false });
  assert.equal((await loadPlayerStats(journal)).players.length, 2);
  const absent = await loadPlayerStats(join(dir, 'absent'));
  assert.equal(absent.players.length, 0); assert.equal(absent.meta.historyValid, false); assert.equal(absent.meta.notes.length, 1);
});

test('source-based deployment uses the generated aggregate when raw logs are absent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'player-stats-deploy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'lib'));
  const aggregate = { version: 1, players: [], meta: { seq: 123 } };
  await writeFile(join(dir, 'lib/player-stats.json'), JSON.stringify(aggregate));
  const plugin = playerStatsPlugin(); plugin.configResolved({ root: dir });
  const result = await plugin.load.call({ addWatchFile() {} }, plugin.resolveId('virtual:player-stats'));
  assert.deepEqual(JSON.parse(result.replace('export default ', '')), aggregate);
});
