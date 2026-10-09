import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRounds, orderMaps } from '../src/map-stats.js';

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
