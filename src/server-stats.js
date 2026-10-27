const GAP = 30 * 60 * 1000;
export function durationColor(seconds, maximum) {
  if (!Number.isFinite(seconds) || seconds < 0) return '#8a9588';
  const fraction = maximum > 0 ? Math.min(1, seconds / maximum) : 0;
  const start = [37, 99, 235], end = [234, 88, 12];
  return `rgb(${start.map((value, index) => Math.round(value + (end[index] - value) * fraction)).join(', ')})`;
}
export function durationSamples(headers, rows) {
  const column = name => headers.indexOf(name);
  const numeric = value => value?.trim() ? Number(value) : NaN;
  return rows.map(row => ({ players: numeric(row[column('player_count')]), seconds: numeric(row[column('duration_seconds')]), map: row[column('map_name')], round: row[column('round')] }))
    .filter(point => Number.isInteger(point.players) && point.players >= 0 && Number.isFinite(point.seconds) && point.seconds >= 0);
}
// Fit original observations, with equal weight per round. Normalize counts to
// keep the small least-squares system well conditioned.
export function durationRegression(points) {
  if (!points.length) return null;
  const min = Math.min(...points.map(p => p.players)), max = Math.max(...points.map(p => p.players));
  const center = (min + max) / 2, scale = (max - min) / 2 || 1;
  const degree = Math.min(2, new Set(points.map(p => p.players)).size - 1);
  const matrix = Array.from({ length: degree + 1 }, () => Array(degree + 2).fill(0));
  for (const point of points) {
    const z = (point.players - center) / scale;
    for (let i = 0; i <= degree; i++) {
      for (let j = 0; j <= degree; j++) matrix[i][j] += z ** (i + j);
      matrix[i][degree + 1] += point.seconds * z ** i;
    }
  }
  for (let i = 0; i <= degree; i++) {
    let pivot = i;
    for (let j = i + 1; j <= degree; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const divisor = matrix[i][i];
    for (let j = i; j <= degree + 1; j++) matrix[i][j] /= divisor;
    for (let row = 0; row <= degree; row++) {
      if (row === i) continue;
      const factor = matrix[row][i];
      for (let j = i; j <= degree + 1; j++) matrix[row][j] -= factor * matrix[i][j];
    }
  }
  const coefficients = matrix.map(row => row[degree + 1]);
  const predict = players => coefficients.reduce((sum, coefficient, i) => sum + coefficient * ((players - center) / scale) ** i, 0);
  const mean = points.reduce((sum, p) => sum + p.seconds, 0) / points.length;
  const total = points.reduce((sum, p) => sum + (p.seconds - mean) ** 2, 0);
  const residual = points.reduce((sum, p) => sum + (p.seconds - predict(p.players)) ** 2, 0);
  return { min, max, degree, predict, r2: total ? 1 - residual / total : 1 };
}

export function durationJitter(index) {
  // Stable across renders; at most 0.18 players of horizontal displacement.
  const value = Math.imul(index + 1, 2654435761) >>> 0;
  return (value / 4294967296 - .5) * .36;
}
export function populationSamples(headers, rows) {
  const column = name => headers.indexOf(name);
  return rows.map(row => {
    const value = row[column('duration_seconds')]?.trim();
    const seconds = value ? Number(value) : NaN;
    return { time: Date.parse(row[column('timestamp_utc')]), players: row[column('player_count')]?.trim() === '' ? NaN : Number(row[column('player_count')]), seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null, map: row[column('map_name')], round: row[column('round')] };
  })
    .filter(point => Number.isFinite(point.time) && Number.isInteger(point.players) && point.players >= 0)
    .sort((a, b) => a.time - b.time);
}
export function populationSessions(points) {
  const sessions = [];
  for (const point of points) {
    if (!sessions.length || point.time - sessions.at(-1).at(-1).time > GAP) sessions.push([]);
    sessions.at(-1).push(point);
  }
  return sessions;
}
export function setupServerStats(headers, rows, dailyPlayers = []) {
  const $ = id => document.getElementById(id);
  const points = populationSamples(headers, rows);
  const sessions = populationSessions(points);
  const durationMaximum = Math.max(0, ...points.map(point => point.seconds ?? 0));
  $('population-duration-max').textContent = `${(durationMaximum / 60).toFixed(1)} min · long`;
  const date = time => new Date(time).toLocaleString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const svg = $('population-chart');
  const make = (tag, attrs = {}, text = '') => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.textContent = text;
    return node;
  };
  const dailyChart = $('daily-players-chart');
  dailyChart.replaceChildren(make('title', {}, 'Daily unique players'), make('desc', {}, 'Distinct player IDs seen on each UTC day. Repeated visits count once per day.'));
  $('daily-players-empty').hidden = dailyPlayers.length > 0;
  $('daily-players-chart-wrap').hidden = !dailyPlayers.length;
  $('daily-players-detail').textContent = dailyPlayers.length ? 'Hover, tap, or focus a bar for its daily total.' : '';
  if (dailyPlayers.length) {
    const width = Math.max(1000, dailyPlayers.length * 70 + 120);
    dailyChart.setAttribute('viewBox', '0 0 ' + width + ' 430');
    dailyChart.style.minWidth = width + 'px';
    const top = Math.max(5, Math.ceil(Math.max(...dailyPlayers.map(day => day.players)) / 5) * 5);
    const y = players => 350 - players / top * 300;
    const step = (width - 120) / dailyPlayers.length;
    for (let i = 0; i <= 5; i++) {
      const value = top * i / 5;
      dailyChart.append(make('line', { x1: 70, x2: width - 50, y1: y(value), y2: y(value), class: 'population-grid' }), make('text', { x: 58, y: y(value) + 4, 'text-anchor': 'end' }, value));
    }
    dailyPlayers.forEach((day, i) => {
      const x = 70 + step * (i + .5);
      const label = day.day + ' UTC · ' + day.players + ' unique players';
      const bar = make('rect', { x: x - Math.min(50, step * .65) / 2, y: y(day.players), width: Math.min(50, step * .65), height: 350 - y(day.players), class: 'daily-player-bar', tabindex: 0, 'aria-label': label });
      bar.append(make('title', {}, label));
      for (const event of ['pointerenter', 'focus', 'click']) bar.addEventListener(event, () => $('daily-players-detail').textContent = label);
      dailyChart.append(bar, make('text', { x, y: y(day.players) - 8, 'text-anchor': 'middle' }, day.players), make('text', { x, y: 375, 'text-anchor': 'middle' }, day.day));
    });
    dailyChart.append(make('text', { x: width / 2, y: 408, 'text-anchor': 'middle' }, 'Day (UTC)'), make('text', { transform: 'translate(20 200) rotate(-90)', 'text-anchor': 'middle' }, 'Unique players'));
  }
  const durations = durationSamples(headers, rows);
  const durationChart = $('duration-chart');
  durationChart.append(make('title', {}, 'Round duration by player count'), make('desc', {}, 'Each point is a recorded round. Player count is on the horizontal axis and duration in minutes is on the vertical axis. Includes rounds without timestamps.'));
  $('duration-empty').hidden = durations.length > 0;
  $('duration-chart-wrap').hidden = !durations.length;
  $('duration-summary').textContent = `${durations.length} rounds · ${rows.length - durations.length} rows without usable count/duration omitted`;
  if (durations.length) {
    const playerStep = Math.max(1, Math.ceil(Math.max(...durations.map(point => point.players)) / 10));
    const playerMax = playerStep * 10;
    const minuteStep = Math.max(1, Math.ceil(Math.max(...durations.map(point => point.seconds / 60)) / 5));
    const minuteMax = minuteStep * 5;
    const x = players => 70 + players / playerMax * 880;
    const y = seconds => 350 - seconds / 60 / minuteMax * 300;
    for (let i = 0; i <= 5; i++) {
      const minutes = minuteStep * i;
      durationChart.append(make('line', { x1: 70, x2: 950, y1: y(minutes * 60), y2: y(minutes * 60), class: 'population-grid' }), make('text', { x: 58, y: y(minutes * 60) + 4, 'text-anchor': 'end' }, minutes));
    }
    for (let i = 0; i <= 10; i++) {
      const players = playerStep * i;
      durationChart.append(make('text', { x: x(players), y: 375, 'text-anchor': 'middle' }, players));
    }
    durationChart.append(make('text', { x: 510, y: 408, 'text-anchor': 'middle' }, 'Player count'), make('text', { transform: 'translate(20 200) rotate(-90)', 'text-anchor': 'middle' }, 'Round duration (minutes)'));
    for (const [index, point] of durations.entries()) {
      const label = `${point.players} players · ${point.seconds} seconds (${(point.seconds / 60).toFixed(2)} minutes) · ${point.map} · round ${point.round}`;
      const jitter = Math.max(-5, Math.min(5, x(point.players + durationJitter(index)) - x(point.players)));
      const dot = make('circle', { cx: x(point.players) + jitter, cy: y(point.seconds), r: 4, class: 'population-dot duration-dot', tabindex: 0, 'aria-label': label });
      dot.append(make('title', {}, label));
      for (const event of ['pointerenter', 'focus', 'click']) dot.addEventListener(event, () => $('duration-detail').textContent = label);
      durationChart.append(dot);
    }
    const fit = durationRegression(durations);
    if (fit.min < fit.max) {
      const label = `${fit.degree === 2 ? 'Quadratic' : 'Linear'} regression · R² = ${fit.r2.toFixed(3)}`;
      const clip = make('clipPath', { id: 'duration-fit-clip' });
      clip.append(make('rect', { x: 70, y: 50, width: 880, height: 300 }));
      const defs = make('defs'); defs.append(clip); durationChart.append(defs);
      const curve = Array.from({ length: 201 }, (_, i) => {
        const players = fit.min + (fit.max - fit.min) * i / 200;
        return `${x(players)},${y(fit.predict(players))}`;
      });
      const line = make('polyline', { points: curve.join(' '), class: 'duration-fit', 'clip-path': 'url(#duration-fit-clip)', 'aria-label': label });
      line.append(make('title', {}, `${label}. Fitted to original values, before jitter.`));
      durationChart.append(line, make('line', { x1: 695, x2: 725, y1: 28, y2: 28, class: 'duration-fit' }), make('text', { x: 735, y: 32 }, label));
    }
  }
  sessions.forEach((session, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `${date(session[0].time)} – ${date(session.at(-1).time)} UTC`;
    $('population-session').append(option);
  });
  $('population-coverage').textContent = `${points.length} timestamped samples · ${rows.length - points.length} rows without usable time/population omitted`;
  const rangeControl = $('population-range');
  function render() {
    const selected = $('population-session').value;
    let visible = selected === 'all' ? points : sessions[Number(selected)];
    const hours = Number(rangeControl.value);
    const rangeLabel = `Past ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    $('population-range-value').textContent = rangeLabel;
    rangeControl.setAttribute('aria-valuetext', rangeLabel);
    const rangeEnd = visible.at(-1)?.time;
    const rangeStart = rangeEnd - hours * 3600000;
    visible = visible.filter(point => point.time >= rangeStart);
    svg.replaceChildren(make('title', {}, 'Server population over time'), make('desc', {}, 'Round-end samples. Long gaps have no connecting line; missing samples do not confirm zero players.'));
    $('population-empty').hidden = visible.length > 0;
    $('population-chart-wrap').hidden = !visible.length;
    const colorByDuration = $('population-duration-color').checked;
    $('population-duration-legend').hidden = !colorByDuration || !visible.length;
    if (!visible.length) {
      $('population-summary').textContent = '0 samples in this time range.';
      $('population-detail').textContent = 'Try a wider time range or choose another session.';
      return;
    }
    const start = rangeStart, end = rangeEnd;
    const maximum = Math.max(5, ...visible.map(point => point.players));
    const top = Math.ceil(maximum / 5) * 5;
    const x = time => 70 + (time - start) / Math.max(1, end - start) * 880;
    const y = players => 350 - players / top * 300;
    for (let i = 0; i <= 5; i++) {
      const value = top * i / 5;
      svg.append(make('line', { x1: 70, x2: 950, y1: y(value), y2: y(value), class: 'population-grid' }), make('text', { x: 58, y: y(value) + 4, 'text-anchor': 'end' }, value));
      const time = start + (end - start) * i / 5;
      svg.append(make('text', { x: x(time), y: 375, 'text-anchor': i === 0 ? 'start' : i === 5 ? 'end' : 'middle' }, date(time)));
    }
    svg.append(make('text', { x: 510, y: 408, 'text-anchor': 'middle' }, 'Time (UTC)'), make('text', { transform: 'translate(20 200) rotate(-90)', 'text-anchor': 'middle' }, 'Server population (players)'));
    const groups = populationSessions(visible);
    for (let i = 1; i < groups.length; i++) {
      const left = x(groups[i - 1].at(-1).time), right = x(groups[i][0].time);
      const gap = make('rect', { x: left, y: 50, width: right - left, height: 300, class: 'population-gap' });
      gap.append(make('title', {}, `${((groups[i][0].time - groups[i - 1].at(-1).time) / 3600000).toFixed(1)} hours without samples; population unknown`));
      svg.append(gap);
    }
    for (const group of groups) {
      if ($('population-style').value === 'line') svg.append(make('polyline', { points: group.map(point => `${x(point.time)},${y(point.players)}`).join(' '), class: 'population-line' }));
      for (const point of group) {
        const duration = point.seconds === null ? 'duration unavailable' : `${point.seconds}s (${(point.seconds / 60).toFixed(2)} min)`;
        const label = `${date(point.time)} UTC · ${point.players} players · ${duration} · ${point.map} · round ${point.round}`;
        const dot = make('circle', { cx: x(point.time), cy: y(point.players), r: 4, class: 'population-dot', tabindex: 0, 'aria-label': label });
        if (colorByDuration) dot.style.setProperty('--point-color', durationColor(point.seconds, durationMaximum));
        dot.append(make('title', {}, label));
        dot.addEventListener('pointerenter', () => $('population-detail').textContent = label);
        dot.addEventListener('focus', () => $('population-detail').textContent = label);
        dot.addEventListener('click', () => $('population-detail').textContent = label);
        svg.append(dot);
      }
    }
    $('population-summary').textContent = `Peak: ${Math.max(...visible.map(point => point.players))} players · ${visible.length} samples · ${date(visible[0].time)} – ${date(visible.at(-1).time)} UTC`;
    $('population-detail').textContent = 'Hover, tap, or focus a point for its time, population, and map.';
  }
  rangeControl.addEventListener('input', render);
  for (const id of ['population-session', 'population-style', 'population-duration-color']) $(id).addEventListener('change', render);
  render();
  return { count: points.length };
}
