import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRounds, orderMaps } from '../src/map-stats.js';

test('rotation numbers follow permanent map IDs instead of engine slots', () => {
  const images = [
    { filename: 'scn_mp_custom_map_1.png', map_id: 'test_map_100' },
    { filename: 'scn_mp_custom_map_2.png', map_id: 'test_map_20' },
    { filename: 'scn_mp_custom_map_3.png', map_id: 'test_map_3' },
  ];
  for (const metric of ['number', 'games']) {
    assert.deepEqual(orderMaps(images, new Map(), metric, 'asc').map(entry => entry.map_id),
      ['test_map_3', 'test_map_20', 'test_map_100']);
  }
  assert.deepEqual(orderMaps(images, new Map(), 'number', 'desc').map(entry => entry.map_id),
    ['test_map_100', 'test_map_20', 'test_map_3']);
});

test('summaries filter inclusive player counts and omit invalid durations', () => {
  const headers = ['player_count', 'result', 'duration_seconds'];
  const rows = [['1', 'team1', '30'], ['5', 'team1', '60'], ['10', 'team2', '120'], ['10', 'draw', ''], ['11', 'team1', '900'], ['', 'team1', '10'], ['5.5', 'team1', '10']];
  assert.deepEqual(summarizeRounds(headers, rows, 5, 10), {
    rows: rows.slice(1, 4), games: 3, durationGames: 2, duration: 90, win: 1 / 3 * 100,
  });
  const empty = summarizeRounds(headers, rows, 30, 30);
  assert.equal(empty.games, 0);
  assert.equal(empty.duration, null);
  assert.equal(empty.win, null);
});

test('sorts each statistic both ways with numeric ties and unavailable values last', () => {
  const images = [10, 2, 1, 3].map(number => ({ filename: `map_${number}.png` }));
  const stats = new Map(images.map((image, index) => [image.filename, {
    games: [5, 5, 0, 10][index], duration: [60, 60, null, 120][index], win: [25, 25, null, 50][index],
  }]));
  const sorted = (metric, direction) => orderMaps(images, stats, metric, direction).map(image => image.filename);
  for (const metric of ['games', 'duration', 'win']) {
    assert.deepEqual(sorted(metric, 'desc'), ['map_3.png', 'map_2.png', 'map_10.png', 'map_1.png']);
    assert.deepEqual(sorted(metric, 'asc'), metric === 'games'
      ? ['map_1.png', 'map_2.png', 'map_10.png', 'map_3.png']
      : ['map_2.png', 'map_10.png', 'map_3.png', 'map_1.png']);
  }
  assert.deepEqual(sorted('number', 'desc'), ['map_10.png', 'map_3.png', 'map_2.png', 'map_1.png']);
  assert.deepEqual(images.map(image => image.filename), ['map_10.png', 'map_2.png', 'map_1.png', 'map_3.png']);
});

// Cross-map analytics use independent duration counts and preserve unknown sizes.
const { analyticsRounds, filterAnalytics, durationSummary, histogram, DURATION_BINS } = await import('../src/map-analytics.js');

test('analytics preserves unknown maps, canonical sizes and invalid-value coverage', () => {
  const headers = ['result', 'map_name', 'player_count', 'duration_seconds'];
  const rows = [
    ['team1', 'test_map_1', '2', '0'], ['draw', 'archived', '5', ''],
    ['team2', 'test_map_1', '', '90'], ['team1', 'test_map_2', '0', '120'],
    ['team2', 'test_map_2', '2.5', '-2'], ['team1', 'test_map_2', '4', 'NaN'],
  ];
  const rounds = analyticsRounds(headers, rows, [{ map_id: 'test_map_1', pool: 'tiny' }], new Set(['test_map_1']));
  assert.equal(rounds[0].duration, 0);
  assert.equal(rounds[1].size, 'unknown');
  assert.equal(rounds[1].duration, null);
  assert.equal(rounds[2].players, null);
  assert.equal(rounds[4].players, null);
  assert.equal(rounds[4].duration, null);
  assert.equal(rounds[5].duration, null);
  assert.deepEqual(filterAnalytics(rounds).map(r => r.map), ['test_map_1', 'archived', 'test_map_2']);
  assert.equal(filterAnalytics(rounds, { scope: 'current' }).length, 1);
  assert.equal(filterAnalytics(rounds, { size: 'unknown', min: 0, max: 5 }).length, 3);
  assert.equal(filterAnalytics(rounds, { min: 5, max: 5 }).length, 1);
});

test('duration summaries interpolate quantiles, omit missing durations and retain zero', () => {
  const rounds = [0, 60, 120, 600, null].map((duration, i) => ({ duration, players: i + 1, result: i === 4 ? 'draw' : 'team1' }));
  const summary = durationSummary(rounds);
  assert.ok(Math.abs(summary.p90 - 456) < 1e-9);
  assert.deepEqual({ ...summary, p90: 456 }, { games: 5, count: 4, mean: 195, median: 90, p90: 456, players: 3, team1: 4, team2: 0, draws: 1 });
  const empty = durationSummary([]);
  assert.equal(empty.mean, null);
  assert.equal(empty.median, null);
  assert.equal(empty.p90, null);
  assert.equal(durationSummary([{ duration: null, players: null }]).count, 0);
});

test('histograms assign exact boundaries once and retain arbitrarily long rounds', () => {
  const values = [0, 59, 60, 120, 180, 300, 600, 900, 20000, null, NaN, -1];
  const bins = histogram(values);
  assert.deepEqual(bins.map(bin => bin.count), [2, 1, 1, 1, 1, 1, 2]);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 9);
  assert.deepEqual(histogram([], DURATION_BINS).map(bin => bin.count), [0, 0, 0, 0, 0, 0, 0]);
});
