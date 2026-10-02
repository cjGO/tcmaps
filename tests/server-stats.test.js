import test from 'node:test';
import assert from 'node:assert/strict';
import { populationSamples, populationSessions } from '../src/server-stats.js';
const headers = ['map_name', 'round', 'player_count', 'timestamp_utc'];
test('preserves zero counts, sorts timestamps and excludes missing or invalid data', () => {
  const points = populationSamples(headers, [
    ['map', '1', '3', '2026-10-01T12:00:00Z'],
    ['map', '2', '0', '2026-10-01T11:00:00Z'],
    ['map', '3', '2', ''], ['map', '4', '', '2026-10-01T13:00:00Z'],
    ['map', '5', '-1', '2026-10-01T13:00:00Z'],
  ]);
  assert.deepEqual(points.map(p => p.players), [0, 3]);
});
test('breaks long gaps without inventing zero-player samples', () => {
  const points = [0, 30, 61, 62].map(minutes => ({ time: minutes * 60000, players: 5 }));
  assert.deepEqual(populationSessions(points).map(group => group.length), [2, 2]);
  assert.deepEqual(populationSessions([]), []);
});
