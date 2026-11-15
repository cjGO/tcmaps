import { summarizeRounds } from './map-stats.js';

export function attachSweepStats(doc, mapId, headers, rows, range) {
  const section = doc.createElement('section'); section.className = 'sweep-round-stats';
  section.innerHTML = `<h2>Round statistics</h2><p data-map></p><p class="hint">All variants combined, including source rounds.</p>
    <div class="pair"><label>Min players<input data-min type="number" min="1" step="1" aria-label="Minimum players"></label><label>Max players<input data-max type="number" min="1" step="1" aria-label="Maximum players"></label></div>
    <div aria-live="polite"><p><strong data-rounds></strong> rounds</p><p>Team 1 win: <strong data-win></strong></p><p class="hint" data-note></p></div>
    <details><summary>Matching rounds</summary><div style="max-height:240px;overflow:auto"><table style="width:100%;font-size:12px;text-align:left"><thead><tr><th>Players</th><th>Result</th><th>Variant</th></tr></thead><tbody></tbody></table></div></details>`;
  const q = selector => section.querySelector(selector);
  q('[data-map]').textContent = mapId;
  const min = q('[data-min]'), max = q('[data-max]');
  function render() {
    min.value = range.min; max.value = range.max;
    const stats = summarizeRounds(headers, rows, range.min, range.max);
    q('[data-rounds]').textContent = stats.games.toLocaleString();
    q('[data-win]').textContent = stats.win === null ? '—' : `${stats.win.toFixed(1)}%`;
    q('[data-note]').textContent = rows.length
      ? `${stats.games} of ${rows.length} recorded rounds match ${range.min}–${range.max} players. Wins divided by all matching rounds, including draws.`
      : 'No recorded rounds for this map.';
    const player = headers.indexOf('player_count'), result = headers.indexOf('result'), variant = headers.indexOf('variant_id');
    q('tbody').replaceChildren(...stats.rows.map(row => {
      const tr = doc.createElement('tr');
      for (const text of [row[player], {team1:'Team 1',team2:'Team 2',draw:'Draw'}[row[result]] || row[result], row[variant] || 'source']) {
        const td = doc.createElement('td'); td.textContent = text; td.style.overflowWrap = 'anywhere'; tr.append(td);
      }
      return tr;
    }));
  }
  function change(which, input) {
    const value = Number(input.value);
    if (!input.value || !Number.isSafeInteger(value) || value < 1) { render(); return; }
    range[which] = value;
    if (range.min > range.max) range[which === 'min' ? 'max' : 'min'] = value;
    render();
  }
  min.addEventListener('change', () => change('min', min));
  max.addEventListener('change', () => change('max', max));
  doc.querySelector('aside').prepend(section); render();
  return section;
}
