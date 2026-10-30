import { csvRows } from './map-identity.js';

export function normalizeFeedback(text, identities) {
  const historical = new Map(identities.map(row => [`${row.timestamp}|${row.recorded_name}`, row.map_id]));
  return csvRows(text).map(row => {
    if (!row.length || !row[0]) return row;
    const permanent = /^(test_map_\d+)(?:_(?:RAW|Var[a-z0-9]+))?$/i.exec(row[2]);
    if (permanent) row[2] = permanent[1];
    else if (/^(?:scn_)?mp_custom_map_\d+$/.test(row[2])) {
      const id = historical.get(`${row[0]}|${row[2]}`);
      if (!id) throw new Error(`Missing historical feedback identity: ${row[0]} ${row[2]}`);
      row[2] = id;
    }
    return row;
  });
}

export function summarizeFeedback(rows) {
  const summaries = new Map();
  for (const row of rows) {
    const rating = row[3]?.trim().toLowerCase();
    if (!row[2] || !['good', 'bad'].includes(rating)) continue;
    if (!summaries.has(row[2])) summaries.set(row[2], { good: 0, bad: 0 });
    summaries.get(row[2])[rating]++;
  }
  return summaries;
}

export function renderFeedback(root, summaries, maps, selectedId, onSelect) {
  const selected = summaries.get(selectedId) || { good: 0, bad: 0 };
  const percent = stats => stats.good + stats.bad ? `${(100 * stats.good / (stats.good + stats.bad)).toFixed(0)}%` : '—';
  root.querySelector('[data-feedback=map]').textContent = selectedId || 'No map selected';
  root.querySelector('[data-feedback=good]').textContent = selected.good;
  root.querySelector('[data-feedback=bad]').textContent = selected.bad;
  root.querySelector('[data-feedback=percent]').textContent = percent(selected);
  root.querySelector('[data-feedback=empty]').hidden = selected.good + selected.bad > 0;
  const document = root.ownerDocument;
  root.querySelector('tbody').replaceChildren(...maps.map(map => {
    const stats = summaries.get(map.map_id) || { good: 0, bad: 0 };
    const tr = document.createElement('tr');
    if (map.map_id === selectedId) tr.setAttribute('aria-current', 'true');
    const heading = document.createElement('th');
    heading.scope = 'row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feedback-map-link';
    button.textContent = map.map_id;
    button.addEventListener('click', () => onSelect(map.filename));
    heading.append(button);
    tr.append(heading);
    for (const value of [stats.good, stats.bad, percent(stats)]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  }));
}
