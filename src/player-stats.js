// Shared definitions keep journal aggregation, charts, and exported figures consistent.
export const COUNTERS = ['personal_kills', 'personal_human_kills', 'personal_bot_kills', 'deaths', 'personal_teamkills', 'squad_kills', 'squad_human_kills', 'squad_bot_kills', 'squad_casualties', 'squad_teamkills', 'rounds', 'wins', 'losses', 'draws'];
export const emptyTotals = () => Object.fromEntries(COUNTERS.map(key => [key, 0]));
export function addTotals(target, source) {
  COUNTERS.forEach((key, i) => { target[key] += (Array.isArray(source) ? source[i] : source[key]) || 0; });
  return target;
}
export const METRICS = {
  squad_kills: { label: 'Squad kills', short: 'Squad kills', kind: 'count' },
  personal_kills: { label: 'Personal kills', short: 'Personal kills', kind: 'count' },
  wins: { label: 'Wins', short: 'Wins', kind: 'count' },
  rounds: { label: 'Completed rounds', short: 'Rounds', kind: 'count' },
  personal_kd: { label: 'Personal K/D', short: 'Personal K/D', kind: 'ratio' },
  squad_kd: { label: 'Squad kill / casualty', short: 'Squad K/C', kind: 'ratio' },
  win_rate: { label: 'Win rate', short: 'Win rate', kind: 'percent' },
  personal_per_round: { label: 'Personal kills / completed round', short: 'Personal / round', kind: 'ratio' },
  squad_per_round: { label: 'Squad kills / completed round', short: 'Squad / round', kind: 'ratio' },
};
const ratio = (a, b) => b > 0 ? a / b : null;
export function metricValue(player, key) {
  const t = player.totals;
  switch (key) {
    case 'personal_kd': return ratio(t.personal_kills, t.deaths);
    case 'squad_kd': return ratio(t.squad_kills, t.squad_casualties);
    case 'win_rate': return ratio(t.wins * 100, t.rounds);
    case 'personal_per_round': return ratio(t.personal_kills, t.rounds);
    case 'squad_per_round': return ratio(t.squad_kills, t.rounds);
    default: return t[key] ?? null;
  }
}
export function formatMetric(value, key) {
  if (value === null || !Number.isFinite(value)) return '—';
  const kind = METRICS[key]?.kind || 'count';
  return value.toLocaleString('en-US', { maximumFractionDigits: kind === 'count' ? 0 : kind === 'percent' ? 1 : 2 }) + (kind === 'percent' ? '%' : '');
}
export function periodPlayers(data, start = '', end = '') {
  return data.players.map(player => {
    if (!start && !end) return { ...player, totals: addTotals(emptyTotals(), player.totals) };
    const totals = emptyTotals();
    player.days.forEach(([day, values]) => {
      if ((!start || day >= start) && (!end || day <= end)) addTotals(totals, values);
    });
    return { ...player, totals };
  });
}
export function filterPlayers(players, { search = '', minRounds = 0 } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return players.filter(p => p.totals.rounds >= minRounds &&
    (!query || [p.name, ...p.aliases].some(name => name.toLocaleLowerCase().includes(query))));
}
export function rankPlayers(players, metric, direction = 'desc') {
  return [...players].sort((a, b) => {
    const x = metricValue(a, metric), y = metricValue(b, metric);
    if (x === null || y === null) return x === y ? a.order - b.order : x === null ? 1 : -1;
    return (direction === 'asc' ? x - y : y - x) || a.order - b.order;
  });
}
export function median(values) {
  const sorted = values.filter(v => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
}
// Wilson interval: descriptive uncertainty, not a skill rating or a matchmaking adjustment.
export function winInterval(wins, rounds) {
  if (!rounds) return null;
  const z = 1.96, p = wins / rounds, denominator = 1 + z * z / rounds;
  const center = (p + z * z / (2 * rounds)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * rounds)) / rounds) / denominator;
  return [Math.max(0, center - half) * 100, Math.min(1, center + half) * 100];
}
export function dailyTotals(players, days, start = '', end = '') {
  const rows = new Map(days.filter(day => (!start || day >= start) && (!end || day <= end)).map(day => [day, emptyTotals()]));
  players.forEach(p => p.days.forEach(([day, values]) => { if (rows.has(day)) addTotals(rows.get(day), values); }));
  return [...rows].map(([day, totals]) => ({ day, totals }));
}
export function leaderboardCsv(players) {
  const keys = Object.keys(METRICS);
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  // Prefix spreadsheet formulas in untrusted display names.
  const safeName = name => /^[=+@\-\t\r\n]/.test(name) ? "'" + name : name;
  return ['Player,' + keys.map(k => quote(METRICS[k].label)).join(','), ...players.map(p =>
    [quote(safeName(p.name)), ...keys.map(key => metricValue(p, key) ?? '')].join(','))].join('\r\n');
}
