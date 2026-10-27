import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyUniquePlayers } from '../src/player-activity.js';
import { playerActivityPlugin } from '../scripts/player-activity.mjs';
const headers = ['player_id', 'player_name', 'login_utc', 'logout_utc'];

test('daily players deduplicate visits, name changes and paired login/logout records', () => {
  assert.deepEqual(dailyUniquePlayers(headers, [
    ['12', 'Alice', '2026-10-25T10:00:00Z', ''],
    ['12', 'Alice', '2026-10-25T10:00:00Z', '2026-10-25T11:00:00Z'],
    ['12', 'Renamed', '2026-10-25T12:00:00Z', '2026-10-25T13:00:00Z'],
    ['13', 'Alice', '2026-10-25T14:00:00Z', '2026-10-25T15:00:00Z'],
    ['13', 'Alice', '2026-10-26T12:00:00Z', ''],
  ]), [{ day: '2026-10-25', players: 2 }, { day: '2026-10-26', players: 1 }]);
});

test('sessions overlap UTC days, midnight logout is exclusive, missing logout never invents presence', () => {
  assert.deepEqual(dailyUniquePlayers(headers, [
    ['12', 'A', '2026-10-25T23:00:00Z', '2026-10-26T01:00:00Z'],
    ['13', 'B', '2026-10-25T23:00:00Z', '2026-10-26T00:00:00Z'],
    ['14', 'C', '2026-10-25T12:00:00Z', ''],
    ['15', 'D', '2026-10-28T01:00:00Z', '2026-10-28T02:00:00Z'],
    ['', 'invalid', '2026-10-25T12:00:00Z', ''],
    ['16', 'invalid', 'invalid', ''],
  ]), [{ day: '2026-10-25', players: 3 }, { day: '2026-10-26', players: 1 }, { day: '2026-10-28', players: 1 }]);
  assert.deepEqual(dailyUniquePlayers([], []), []);
});

test('activity plugin publishes only aggregate daily totals', async () => {
  const { fileURLToPath } = await import('node:url');
  const plugin = playerActivityPlugin();
  plugin.configResolved({ root: fileURLToPath(new URL('../', import.meta.url)) });
  const source = await plugin.load.call({ addWatchFile() {} }, plugin.resolveId('virtual:daily-players'));
  const days = JSON.parse(source.replace('export default ', ''));
  assert.ok(days.length > 0);
  assert.ok(days.every(day => Object.keys(day).sort().join(',') === 'day,players' && Number.isInteger(day.players)));
});
