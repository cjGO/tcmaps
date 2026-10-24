import { upperIndex } from './tactical-replay.js';

// Count recorded lifetimes, independently of position samples and display filters.
// Each bot interval is half-open: spawns/control changes apply immediately, and
// a removal ceases to count at its recorded timestamp (whatever its reason).
export function botStrengthHistory(replay) {
  const teams = new Set([0, 1]), events = new Map();
  function delta(t, team, amount) {
    if (t > replay.coverageEnd) return;
    const changes = events.get(t) || new Map();
    changes.set(team, (changes.get(team) || 0) + amount);
    events.set(t, changes);
  }
  for (const track of replay.tracks.values()) {
    for (let i = 0; i < track.changes.length; i++) {
      const meta = track.changes[i];
      const start = Math.max(track.birth, meta.t), end = Math.min(track.death, track.changes[i + 1]?.t ?? Infinity);
      if (meta.kind !== 'bot' || start >= end || start > replay.coverageEnd) continue;
      teams.add(meta.team);
      delta(start, meta.team, 1);
      delta(end, meta.team, -1);
    }
  }
  const order = [...teams].sort((a, b) => a - b), counts = order.map(() => 0);
  const indices = new Map(order.map((team, i) => [team, i]));
  const points = [];
  for (const [t, changes] of [...events].sort(([a], [b]) => a - b)) {
    for (const [team, amount] of changes) counts[indices.get(team)] += amount;
    if (t <= replay.first) {
      points[0] = { t: replay.first, counts: [...counts] };
    } else {
      if (!points.length) points.push({ t: replay.first, counts: order.map(() => 0) });
      if (changes.size && [...changes.values()].some(amount => amount !== 0)) points.push({ t, counts: [...counts] });
    }
  }
  if (!points.length) points.push({ t: replay.first, counts: [...counts] });
  return { teams: order, points, max: points.reduce((max, point) => Math.max(max, ...point.counts), 1) };
}

export function botStrengthAt(history, t) {
  return history.points[upperIndex(history.points, t)]?.counts ?? history.teams.map(() => 0);
}

const teamLabel = team => team < 0 ? 'Unassigned' : `Team ${team + 1}`;
const teamColor = team => team === 0 ? '#2875cf' : team === 1 ? '#cf4242' : '#8b6811';
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function createBotStrengthChart(container, replay, seek) {
  const history = botStrengthHistory(replay), ns = 'http://www.w3.org/2000/svg';
  container.replaceChildren();
  const title = document.createElement('strong'); title.textContent = 'Bots alive';
  const legend = document.createElement('div'); legend.className = 'replay-strength-legend';
  const outputs = history.teams.map(team => {
    const card = document.createElement('span'); card.className = 'replay-strength-team';
    card.style.setProperty('--team-color', teamColor(team));
    const label = document.createElement('span'); label.textContent = teamLabel(team);
    const count = document.createElement('output');
    count.setAttribute('aria-label', `${teamLabel(team)} bots alive`);
    card.append(label, count); legend.append(card); return count;
  });
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Bots alive by team over recording time. Use the replay timeline to seek with the keyboard.');
  function node(tag, attrs, text) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    svg.append(el); return el;
  }
  const left = 45, top = 12, bottom = 118;
  let right = 985, width = 1000, cursor, dots, currentTime = replay.first;
  const x = t => left + (t - replay.first) / Math.max(1, replay.coverageEnd - replay.first) * (right - left);
  const y = count => bottom - count / history.max * (bottom - top);
  function draw() {
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} 150`);
    right = width - 15;
    for (const count of [0, history.max]) {
      node('line', { x1: left, x2: right, y1: y(count), y2: y(count), class: 'replay-strength-grid' });
      node('text', { x: left - 8, y: y(count) + 4, 'text-anchor': 'end' }, String(count));
    }
    history.teams.forEach((team, i) => {
      let path = `M${left},${y(history.points[0].counts[i])}`;
      for (const point of history.points.slice(1)) path += `H${x(point.t)}V${y(point.counts[i])}`;
      path += `H${x(replay.coverageEnd)}`;
      node('path', { d: path, fill: 'none', stroke: teamColor(team), 'stroke-width': 2.5, 'stroke-dasharray': team === 1 ? '7 3' : team === 0 ? 'none' : '2 3', 'vector-effect': 'non-scaling-stroke' });
    });
    cursor = node('line', { x1: left, x2: left, y1: top - 4, y2: bottom + 4, class: 'replay-strength-cursor' });
    dots = history.teams.map(team => node('circle', { cx: left, cy: bottom, r: 4, fill: teamColor(team), stroke: 'white', 'stroke-width': 1.5 }));
    node('text', { x: left, y: 143 }, clock(replay.first - replay.header.round_start_ms));
    node('text', { x: right, y: 143, 'text-anchor': 'end' }, clock(replay.coverageEnd - replay.header.round_start_ms));
  }
  draw();
  const note = document.createElement('p');
  note.textContent = 'Whole-team totals, independent of map filters. Click or drag the chart to seek. Counts follow recorded spawns, removals and player control; position gaps do not reduce totals. Coverage begins at the first snapshot.';
  container.append(title, legend, svg, note);
  function seekPointer(event) {
    const rect = svg.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * width - left) / (right - left)));
    seek(Math.round(replay.first + fraction * (replay.coverageEnd - replay.first)));
  }
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    svg.setPointerCapture(event.pointerId); seekPointer(event);
  });
  svg.addEventListener('pointermove', event => { if (svg.hasPointerCapture(event.pointerId)) seekPointer(event); });
  svg.addEventListener('pointerup', event => { if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId); });
  function update(t) {
    currentTime = t;
    const counts = botStrengthAt(history, t);
    cursor.setAttribute('x1', x(t)); cursor.setAttribute('x2', x(t));
    outputs.forEach((output, i) => {
      const value = String(counts[i]);
      if (output.textContent !== value) output.textContent = value;
      dots[i].setAttribute('cx', x(t)); dots[i].setAttribute('cy', y(counts[i]));
    });
  }
  const observer = new ResizeObserver(() => {
    const nextWidth = Math.max(280, Math.round(svg.getBoundingClientRect().width));
    if (nextWidth === width) return;
    width = nextWidth; draw(); update(currentTime);
  });
  observer.observe(svg);
  return { update, dispose: () => observer.disconnect() };
}
