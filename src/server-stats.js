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

// Natural cubic regression spline: evenly spaced interior knots, linear tails.
// Solve least squares with reorthogonalized QR, preserving equal weight per round.
export function durationSpline(points, knotCount = 2) {
  if (!points.length) return null;
  const min = Math.min(...points.map(p => p.players)), max = Math.max(...points.map(p => p.players));
  const distinct = new Set(points.map(p => p.players)).size;
  const requested = Math.max(2, Math.min(5, Math.round(knotCount) || 2));
  for (let count = Math.min(requested, distinct - 2); count >= 1; count--) {
    const knots = Array.from({ length: count + 2 }, (_, i) => i / (count + 1));
    const cube = value => Math.max(0, value) ** 3;
    const d = (z, knot) => (cube(z - knot) - cube(z - 1)) / (1 - knot);
    const basis = players => {
      const z = (players - min) / (max - min);
      return [1, z, ...knots.slice(0, -2).map(knot => d(z, knot) - d(z, knots.at(-2)))];
    };
    const rows = points.map(p => basis(p.players));
    const size = count + 2, q = [], r = Array.from({ length: size }, () => Array(size).fill(0));
    let singular = false;
    for (let j = 0; j < size; j++) {
      const column = rows.map(row => row[j]);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < j; i++) {
          const projection = column.reduce((sum, v, k) => sum + v * q[i][k], 0);
          r[i][j] += projection;
          column.forEach((v, k) => { column[k] = v - projection * q[i][k]; });
        }
      }
      r[j][j] = Math.sqrt(column.reduce((sum, v) => sum + v * v, 0));
      if (r[j][j] < 1e-10 * Math.sqrt(points.length)) { singular = true; break; }
      q.push(column.map(v => v / r[j][j]));
    }
    if (singular) continue;
    const coefficients = q.map(column => column.reduce((sum, v, i) => sum + v * points[i].seconds, 0));
    for (let i = size - 1; i >= 0; i--) {
      for (let j = i + 1; j < size; j++) coefficients[i] -= r[i][j] * coefficients[j];
      coefficients[i] /= r[i][i];
    }
    const predict = players => basis(players).reduce((sum, v, i) => sum + v * coefficients[i], 0);
    const mean = points.reduce((sum, p) => sum + p.seconds, 0) / points.length;
    const total = points.reduce((sum, p) => sum + (p.seconds - mean) ** 2, 0);
    const residual = points.reduce((sum, p) => sum + (p.seconds - predict(p.players)) ** 2, 0);
    return { min, max, predict, r2: total ? 1 - residual / total : 1, knots: knots.slice(1, -1).map(k => min + k * (max - min)), label: `Natural cubic spline · ${count} ${count === 1 ? 'knot' : 'knots'}` };
  }
  return { ...durationRegression(points), knots: [], label: distinct > 1 ? 'Linear fit (sparse counts)' : 'Constant fit (one count)' };
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
export function weeklyPopulation(points) {
  if (!points.length) return [];
  const hour = 3600000;
  const latest = Math.max(...points.map(point => point.time));
  const start = Math.floor(latest / hour) * hour - 167 * hour;
  const recent = new Map(), history = new Map();
  const weekdayHour = time => {
    const date = new Date(time);
    return date.getUTCDay() * 24 + date.getUTCHours();
  };
  const add = (buckets, key, players) => {
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += players;
    bucket.count++;
    buckets.set(key, bucket);
  };
  for (const point of points) {
    add(history, weekdayHour(point.time), point.players);
    if (point.time >= start) add(recent, Math.floor(point.time / hour) * hour, point.players);
  }
  return Array.from({ length: 168 }, (_, index) => {
    const time = start + index * hour;
    const current = recent.get(time), average = history.get(weekdayHour(time));
    return { time, players: current ? current.total / current.count : null, count: current?.count ?? 0,
      average: average ? average.total / average.count : null, averageCount: average?.count ?? 0 };
  });
}
export function setupServerStats(headers, rows, dailyPlayers = [], weeklyPlayers = []) {
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
  const latestWeek = weeklyPlayers.at(-1);
  $('weekly-players-summary').textContent = latestWeek ? `Past 7 days: ${latestWeek.players} unique players · ${latestWeek.start} – ${latestWeek.day} UTC (latest activity)` : '';
  function renderPlayerActivity() {
    const weekly = $('daily-players-view').value === 'weekly';
    const activity = weekly ? weeklyPlayers : dailyPlayers;
    const title = weekly ? 'Rolling 7-day unique players' : 'Daily unique players';
    $('daily-players-title').textContent = title;
    $('weekly-players-note').hidden = !weekly;
    dailyChart.setAttribute('aria-label', title);
    $('daily-players-chart-wrap').setAttribute('aria-label', `Scrollable ${title.toLowerCase()} chart`);
    dailyChart.replaceChildren(make('title', {}, title), make('desc', {}, weekly ? 'Distinct players over each trailing seven UTC dates, deduplicated across days.' : 'Distinct player IDs seen on each UTC day. Repeated visits count once per day.'));
    $('daily-players-empty').hidden = activity.length > 0;
    $('daily-players-chart-wrap').hidden = !activity.length;
    $('daily-players-detail').textContent = activity.length ? 'Hover, tap, or focus a bar for its total.' : '';
    if (activity.length) {
      const width = Math.max(1000, activity.length * 70 + 120);
      dailyChart.setAttribute('viewBox', '0 0 ' + width + ' 430');
      dailyChart.style.minWidth = width + 'px';
      const top = Math.max(5, Math.ceil(Math.max(...activity.map(day => day.players)) / 5) * 5);
      const y = players => 350 - players / top * 300;
      const step = (width - 120) / activity.length;
      for (let i = 0; i <= 5; i++) {
        const value = top * i / 5;
        dailyChart.append(make('line', { x1: 70, x2: width - 50, y1: y(value), y2: y(value), class: 'population-grid' }), make('text', { x: 58, y: y(value) + 4, 'text-anchor': 'end' }, value));
      }
      activity.forEach((day, i) => {
        const x = 70 + step * (i + .5);
        const label = (weekly ? `${day.start} – ${day.day}` : day.day) + ' UTC · ' + day.players + ' unique players';
        const bar = make('rect', { x: x - Math.min(50, step * .65) / 2, y: y(day.players), width: Math.min(50, step * .65), height: 350 - y(day.players), class: 'daily-player-bar', tabindex: 0, 'aria-label': label });
        bar.append(make('title', {}, label));
        for (const event of ['pointerenter', 'focus', 'click']) bar.addEventListener(event, () => $('daily-players-detail').textContent = label);
        dailyChart.append(bar, make('text', { x, y: y(day.players) - 8, 'text-anchor': 'middle' }, day.players), make('text', { x, y: 375, 'text-anchor': 'middle' }, day.day));
      });
      dailyChart.append(make('text', { x: width / 2, y: 408, 'text-anchor': 'middle' }, weekly ? '7-day window ending (UTC)' : 'Day (UTC)'), make('text', { transform: 'translate(20 200) rotate(-90)', 'text-anchor': 'middle' }, 'Unique players'));
    }
  }
  $('daily-players-view').addEventListener('change', renderPlayerActivity);
  renderPlayerActivity();
  const durations = durationSamples(headers, rows);
  const durationChart = $('duration-chart');
  function renderDuration() {
    durationChart.replaceChildren(make('title', {}, 'Round duration by player count'), make('desc', {}, 'Each point is a recorded round. Player count is on the horizontal axis and duration in minutes is on the vertical axis. Includes rounds without timestamps.'));
    $('duration-empty').hidden = durations.length > 0;
    $('duration-chart-wrap').hidden = !durations.length;
    $('duration-summary').textContent = `${durations.length} rounds · ${rows.length - durations.length} rows without usable count/duration omitted`;
    if (durations.length) {
      const fit = durationSpline(durations, Number($('duration-knots').value));
      const extrapolate = fit.min < fit.max && fit.max < 50;
      const projected = extrapolate ? Array.from({ length: 201 }, (_, i) => fit.predict(fit.max + (50 - fit.max) * i / 200)) : [];
      const fitted = Array.from({ length: 201 }, (_, i) => fit.predict(fit.min + (fit.max - fit.min) * i / 200));
      const playerStep = Math.max(5, Math.ceil(fit.max / 10));
      const playerMax = playerStep * 10;
      const low = Math.min(0, ...fitted.map(v => v / 60), ...projected.map(v => v / 60));
      const high = Math.max(...durations.map(p => p.seconds / 60), ...fitted.map(v => v / 60), ...projected.map(v => v / 60));
      const minuteStep = Math.max(1, Math.ceil((high - low) / 5));
      const minuteMin = Math.floor(low / minuteStep) * minuteStep;
      const minuteMax = Math.ceil(high / minuteStep) * minuteStep;
      const x = players => 70 + players / playerMax * 880;
      const y = seconds => 350 - (seconds / 60 - minuteMin) / (minuteMax - minuteMin || 1) * 300;
      if (extrapolate) {
        durationChart.append(
          make('rect', { x: x(fit.max), y: 50, width: x(50) - x(fit.max), height: 300, class: 'duration-extrapolation-region' }),
          make('line', { x1: x(fit.max), x2: x(fit.max), y1: 50, y2: 350, class: 'duration-extrapolation-boundary' })
        );
        const estimate = fit.predict(50) / 60;
        $('duration-summary').textContent += ` · 50-player extrapolation: ${estimate.toFixed(2)} min${estimate < 0 ? ' (negative model output; not a valid duration)' : ''}`;
      }
      for (let minutes = minuteMin; minutes <= minuteMax; minutes += minuteStep) {
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
      if (fit.min < fit.max) {
        const label = `${fit.label} · R² = ${fit.r2.toFixed(3)}`;
        const clip = make('clipPath', { id: 'duration-fit-clip' });
        clip.append(make('rect', { x: 70, y: 50, width: 880, height: 300 }));
        const defs = make('defs'); defs.append(clip); durationChart.append(defs);
        const curve = Array.from({ length: 201 }, (_, i) => {
          const players = fit.min + (fit.max - fit.min) * i / 200;
          return `${x(players)},${y(fit.predict(players))}`;
        });
        const line = make('polyline', { points: curve.join(' '), class: 'duration-fit', 'clip-path': 'url(#duration-fit-clip)', 'aria-label': label });
        line.append(make('title', {}, `${label}. Fitted to original values, before jitter.`));
        durationChart.append(line, make('line', { x1: 70, x2: 100, y1: 28, y2: 28, class: 'duration-fit' }), make('text', { x: 110, y: 32 }, label));
        if (extrapolate) {
          const extension = make('polyline', {
            points: projected.map((seconds, i) => `${x(fit.max + (50 - fit.max) * i / 200)},${y(seconds)}`).join(' '),
            class: 'duration-fit duration-extrapolation', 'clip-path': 'url(#duration-fit-clip)', 'aria-label': 'Extrapolated regression to 50 players'
          });
          extension.append(make('title', {}, 'Same regression extended beyond recorded counts to 50 players; uncertain estimate.'));
          durationChart.append(extension,
            make('line', { x1: 620, x2: 650, y1: 28, y2: 28, class: 'duration-fit duration-extrapolation' }),
            make('text', { x: 660, y: 32 }, 'Extrapolation · no recorded rounds'));
        }
      }
    }
  }
  $('duration-knots').addEventListener('change', renderDuration);
  renderDuration();
  sessions.forEach((session, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `${date(session[0].time)} – ${date(session.at(-1).time)} UTC`;
    $('population-session').append(option);
  });
  $('population-coverage').textContent = `${points.length} timestamped samples · ${rows.length - points.length} rows without usable time/population omitted`;
  const rangeControl = $('population-range');
  const weekly = weeklyPopulation(points);
  function renderWeekly() {
    const overlay = $('population-average').checked;
    svg.replaceChildren(make('title', {}, 'Past week population and full-dataset weekly average'), make('desc', {}, 'Hourly round-sample averages in UTC. Dashed line shows all recorded rounds at the matching weekday and hour. Missing hours break each line.'));
    svg.setAttribute('aria-label', 'Past week population and full-dataset weekly average by UTC hour');
    $('population-empty').hidden = !!weekly.length;
    $('population-chart-wrap').hidden = !weekly.length;
    $('population-duration-legend').hidden = true;
    $('population-weekly-legend').hidden = !weekly.length;
    $('population-weekly-legend').querySelector('.population-average-swatch').hidden = !overlay;
    if (!weekly.length) {
      $('population-summary').textContent = '0 samples available for the past week.';
      $('population-detail').textContent = '';
      return;
    }
    const start = weekly[0].time, end = weekly.at(-1).time + 3600000;
    const top = Math.ceil(Math.max(5, ...weekly.flatMap(p => [p.players ?? 0, overlay ? p.average ?? 0 : 0])) / 5) * 5;
    const x = time => 70 + (time - start) / (end - start) * 880;
    const y = players => 350 - players / top * 300;
    for (let i = 0; i <= 5; i++) {
      const value = top * i / 5;
      svg.append(make('line', { x1: 70, x2: 950, y1: y(value), y2: y(value), class: 'population-grid' }), make('text', { x: 58, y: y(value) + 4, 'text-anchor': 'end' }, value));
    }
    for (let i = 0; i <= 7; i++) {
      const time = start + i * 24 * 3600000;
      const label = new Date(time).toLocaleString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
      svg.append(make('text', { x: x(time), y: 375, 'text-anchor': i === 0 ? 'start' : i === 7 ? 'end' : 'middle' }, label));
    }
    svg.append(make('text', { x: 510, y: 408, 'text-anchor': 'middle' }, `Time (UTC) · daily ticks at ${new Date(start).getUTCHours().toString().padStart(2, '0')}:00`), make('text', { transform: 'translate(20 200) rotate(-90)', 'text-anchor': 'middle' }, 'Average population (players)'));
    for (const key of overlay ? ['average', 'players'] : ['players']) {
      const className = key === 'average' ? 'population-average' : 'population-week';
      let segment = [];
      const flush = () => {
        if (segment.length && $('population-style').value === 'line') svg.append(make('polyline', { points: segment.join(' '), class: `population-line ${className}` }));
        segment = [];
      };
      for (const point of weekly) {
        if (point[key] === null) { flush(); continue; }
        const time = point.time + 1800000;
        segment.push(`${x(time)},${y(point[key])}`);
        const label = `${date(point.time)} UTC · ${key === 'average' ? 'Full-dataset weekday/hour average' : 'Past week hourly average'}: ${point[key].toFixed(2)} players · ${key === 'average' ? point.averageCount : point.count} rounds`;
        const dot = make('circle', { cx: x(time), cy: y(point[key]), r: 3, class: `population-dot ${className}`, tabindex: 0, 'aria-label': label });
        dot.append(make('title', {}, label));
        for (const event of ['pointerenter', 'focus', 'click']) dot.addEventListener(event, () => $('population-detail').textContent = label);
        svg.append(dot);
      }
      flush();
    }
    $('population-summary').textContent = `Past week: ${date(start)} – ${date(points.at(-1).time)} UTC · ${weekly.reduce((sum, p) => sum + p.count, 0)} rounds${overlay ? ` · Weekly average from all ${points.length} recorded rounds` : ''}`;
    $('population-detail').textContent = 'Hover, tap, or focus a point for its hourly average and sample count.';
  }
  function render() {
    const isWeekly = $('population-view').value === 'weekly';
    for (const id of ['population-session', 'population-range', 'population-duration-color']) $(id).disabled = isWeekly;
    $('population-average-control').hidden = !isWeekly;
    $('population-weekly-note').hidden = !isWeekly;
    $('population-weekly-legend').hidden = true;
    if (isWeekly) { renderWeekly(); return; }
    svg.setAttribute('aria-label', 'Server population versus UTC time');
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
  for (const id of ['population-view', 'population-average', 'population-session', 'population-style', 'population-duration-color']) $(id).addEventListener('change', render);
  render();
  return { count: points.length };
}
