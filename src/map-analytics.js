// Analytics consume the same canonical map IDs as the rotation statistics.
export const MAP_SIZES = ['tiny', 'small', 'medium', 'unknown'];
export const DURATION_BINS = [0, 60, 120, 180, 300, 600, 900, Infinity];
export const PLAYER_BANDS = [[0, 0], [1, 1], [2, 5], [6, 10], [11, 15], [16, 20], [21, 30], [31, Infinity]];
const numeric = value => value == null || String(value).trim() === '' ? null : Number(value);

export function analyticsRounds(headers, rows, installedMaps, currentIds) {
  const sizes = new Map(installedMaps.map(map => [map.map_id, map.pool]));
  const index = Object.fromEntries(['map_name', 'duration_seconds', 'player_count', 'result'].map(key => [key, headers.indexOf(key)]));
  return rows.filter(row => row[index.map_name]).map(row => {
    const players = numeric(row[index.player_count]);
    const duration = numeric(row[index.duration_seconds]);
    const map = row[index.map_name];
    return { map, size: sizes.get(map) || 'unknown', current: currentIds.has(map),
      players: Number.isInteger(players) && players >= 0 ? players : null,
      duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
      result: row[index.result] };
  });
}

export function filterAnalytics(rounds, { scope = 'all', size = 'all', min = 1, max = Infinity } = {}) {
  return rounds.filter(round => (scope !== 'current' || round.current) && (size === 'all' || round.size === size)
    && round.players !== null && round.players >= min && round.players <= max);
}

export function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

export function durationSummary(rounds) {
  const durations = rounds.map(round => round.duration).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const players = rounds.map(round => round.players).filter(value => value !== null && Number.isFinite(value));
  const count = durations.length;
  return { games: rounds.length, count, mean: count ? durations.reduce((a, b) => a + b, 0) / count : null,
    median: quantile(durations, .5), p90: quantile(durations, .9),
    players: players.length ? players.reduce((a, b) => a + b, 0) / players.length : null,
    team1: rounds.filter(round => round.result === 'team1').length,
    team2: rounds.filter(round => round.result === 'team2').length,
    draws: rounds.filter(round => round.result === 'draw').length };
}

// Left-inclusive bins, including a final overflow bin: no long rounds disappear.
export function histogram(values, edges = DURATION_BINS) {
  return edges.slice(0, -1).map((low, index) => ({ low, high: edges[index + 1],
    count: values.filter(value => Number.isFinite(value) && value >= low && value < edges[index + 1]).length }));
}

export function formatDuration(seconds) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}
