import { MAP_SIZES, PLAYER_BANDS, analyticsRounds, filterAnalytics, durationSummary, histogram, formatDuration } from './map-analytics.js';
import './map-analytics.css';

const $ = id => document.getElementById(id);
const label = size => size[0].toUpperCase() + size.slice(1);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function table(headers, rows) {
  const node = element('table');
  const head = element('thead'), tr = element('tr');
  headers.forEach(text => { const th = element('th', text); th.scope = 'col'; tr.append(th); });
  head.append(tr);
  const body = element('tbody');
  rows.forEach(cells => {
    const row = element('tr');
    cells.forEach((content, index) => {
      const cell = element(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      cell.append(content instanceof Node ? content : document.createTextNode(String(content)));
      row.append(cell);
    });
    body.append(row);
  });
  node.append(head, body);
  return node;
}
function bars(bins, total, normalized = false, color = 'tiny') {
  const node = element('div', undefined, `analytics-bars analytics-${color}`);
  const max = normalized ? 100 : Math.max(1, ...bins.map(bin => bin.count));
  bins.forEach(bin => {
    const row = element('div', undefined, 'analytics-bar-row');
    const value = normalized ? (total ? bin.count / total * 100 : 0) : bin.count;
    const track = element('div', undefined, 'analytics-bar-track');
    const fill = element('span'); fill.style.width = `${value / max * 100}%`; track.append(fill);
    const description = `${bin.label}: ${bin.count} rounds${normalized ? ` (${value.toFixed(1)}%)` : ''}`;
    row.title = description;
    row.append(element('span', bin.label), track, element('span', normalized ? `${value.toFixed(1)}% · ${bin.count}` : String(bin.count)));
    node.append(row);
  });
  return node;
}
export function renderDurationDistribution(container, rounds, { normalized = false, color = 'tiny' } = {}) {
  const summary = durationSummary(rounds);
  const bins = histogram(rounds.map(round => round.duration)).map(bin => ({ ...bin,
    label: bin.high === Infinity ? `${bin.low / 60}+ min` : `${bin.low / 60}–${bin.high / 60} min` }));
  container.replaceChildren(element('p', `${summary.count} timed rounds · Median ${formatDuration(summary.median)} · 90th percentile ${formatDuration(summary.p90)}`, 'analytics-chart-note'));
  if (summary.count) container.append(bars(bins, summary.count, normalized, color));
  else container.append(element('p', 'No valid durations in this selection.', 'analytics-chart-note'));
}

export function setupMapAnalytics(headers, rows, installedMaps, currentIds, openMap) {
  const rounds = analyticsRounds(headers, rows, installedMaps, currentIds);
  const maxPlayers = Math.max(30, ...rounds.map(round => round.players ?? 0));
  for (const end of ['min', 'max']) $(`mapstats-player-${end}`).max = maxPlayers;
  $('mapstats-player-max').value = maxPlayers;
  function render() {
    let min = Number($('mapstats-player-min').value), max = Number($('mapstats-player-max').value);
    min = Math.max(0, Math.min(maxPlayers, Math.floor(min)));
    max = Math.max(min, Math.min(maxPlayers, Math.floor(max)));
    $('mapstats-player-min').value = min; $('mapstats-player-max').value = max;
    const filtered = filterAnalytics(rounds, { min, max, scope: $('mapstats-scope').value, size: $('mapstats-size').value });
    const summary = durationSummary(filtered);
    const maps = [...new Set(filtered.map(round => round.map))];
    $('mapstats-summary').textContent = `${filtered.length.toLocaleString()} rounds · ${maps.length} maps · ${summary.count.toLocaleString()} valid durations · Mean ${formatDuration(summary.mean)} · Median ${formatDuration(summary.median)}`;
    const invalidPlayers = rounds.filter(round => round.players === null).length;
    $('mapstats-coverage').textContent = `Dataset: ${rounds.length.toLocaleString()} recorded rounds across ${new Set(rounds.map(round => round.map)).size} maps. ${rounds.filter(round => round.size === 'unknown').length.toLocaleString()} rounds have no size in the installed map roster; they remain Unknown. ${invalidPlayers} rounds have invalid player counts and are excluded. Size labels and legacy slot identities use the installed roster; historical size or slot changes cannot be reconstructed.`;
    $('mapstats-empty').hidden = filtered.length > 0;
    const sizes = MAP_SIZES.filter(size => $('mapstats-size').value === 'all' || $('mapstats-size').value === size);
    const grouped = sizes.map(size => ({ size, rounds: filtered.filter(round => round.size === size) }));
    $('mapstats-size-table').replaceChildren(table(['Size', 'Maps', 'Rounds', 'Timed', 'Mean', 'Median', '90th %ile', 'Avg players'], grouped.map(group => {
      const s = durationSummary(group.rounds);
      return [label(group.size), new Set(group.rounds.map(round => round.map)).size, s.games, s.count, formatDuration(s.mean), formatDuration(s.median), formatDuration(s.p90), s.players?.toFixed(1) ?? '—'];
    })));
    $('mapstats-distributions').replaceChildren(...grouped.map(group => {
      const card = element('section', undefined, 'analytics-distribution');
      const chart = element('div');
      card.append(element('h3', label(group.size)), chart);
      renderDurationDistribution(chart, group.rounds, { normalized: $('mapstats-scale').value === 'percent', color: group.size });
      return card;
    }));
    $('mapstats-player-comparison').replaceChildren(table(['Players', ...sizes.map(label)], PLAYER_BANDS.filter(([low, high]) => high >= min && low <= max).map(([low, high]) => [
      high === Infinity ? `${low}+` : low === high ? String(low) : `${low}–${high}`,
      ...grouped.map(group => {
        const s = durationSummary(group.rounds.filter(round => round.players >= low && round.players <= high));
        return s.count ? `${formatDuration(s.mean)} · n=${s.count}` : '—';
      }),
    ])));
    $('mapstats-population').replaceChildren(bars(PLAYER_BANDS.map(([low, high]) => ({ label: high === Infinity ? `${low}+` : low === high ? `${low}` : `${low}–${high}`, count: filtered.filter(round => round.players >= low && round.players <= high).length })), filtered.length));
    const results = ['team1', 'team2', 'draw'];
    $('mapstats-outcomes').replaceChildren(bars([...results, 'other'].map(result => ({ label: { team1: 'Team 1', team2: 'Team 2', draw: 'Draw', other: 'Other' }[result], count: filtered.filter(round => result === 'other' ? !results.includes(round.result) : round.result === result).length })), filtered.length, true));
    const threshold = Math.max(1, Math.floor(Number($('mapstats-min-rounds').value) || 1));
    $('mapstats-min-rounds').value = threshold;
    const metric = $('mapstats-sort').value;
    const sign = $('mapstats-direction').value === 'asc' ? 1 : -1;
    const entries = maps.map(map => {
      const matching = filtered.filter(round => round.map === map);
      return { map, size: matching[0].size, ...durationSummary(matching) };
    }).filter(entry => entry.games >= threshold).sort((a, b) => {
      const tie = a.map.localeCompare(b.map, undefined, { numeric: true });
      if (metric === 'map') return sign * tie;
      return a[metric] === null || b[metric] === null ? (a[metric] === b[metric] ? tie : a[metric] === null ? 1 : -1) : sign * (a[metric] - b[metric]) || tie;
    });
    $('mapstats-map-note').textContent = `${entries.length} of ${maps.length} maps shown with at least ${threshold} matching rounds. This threshold only affects this table. Click a current map to inspect it in rotation. Team 1 % uses all matching rounds, including draws.`;
    $('mapstats-maps').replaceChildren(table(['Map', 'Size', 'Rounds', 'Timed', 'Mean', 'Median', '90th %ile', 'Avg players', 'Team 1 %'], entries.map(entry => {
      let name = entry.map;
      if (currentIds.has(entry.map)) {
        name = element('button', entry.map, 'feedback-map-link');
        name.addEventListener('click', () => openMap(entry.map));
      }
      return [name, label(entry.size), entry.games, entry.count, formatDuration(entry.mean), formatDuration(entry.median), formatDuration(entry.p90), entry.players?.toFixed(1) ?? '—', `${(entry.team1 / entry.games * 100).toFixed(1)}%`];
    })));
    if (!entries.length) $('mapstats-maps').append(element('p', 'No maps meet the minimum round count.', 'analytics-chart-note'));
  }
  document.querySelectorAll('#mapstats-panel select, #mapstats-panel input').forEach(control => control.addEventListener('change', render));
  render();
  return { count: rounds.length };
}
