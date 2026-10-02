const GAP = 30 * 60 * 1000;
export function durationSamples(headers, rows) {
  const column = name => headers.indexOf(name);
  const numeric = value => value?.trim() ? Number(value) : NaN;
  return rows.map(row => ({ players: numeric(row[column('player_count')]), seconds: numeric(row[column('duration_seconds')]), map: row[column('map_name')], round: row[column('round')] }))
    .filter(point => Number.isInteger(point.players) && point.players >= 0 && Number.isFinite(point.seconds) && point.seconds >= 0);
}
export function populationSamples(headers, rows) {
  const column = name => headers.indexOf(name);
  return rows.map(row => ({ time: Date.parse(row[column('timestamp_utc')]), players: row[column('player_count')]?.trim() === '' ? NaN : Number(row[column('player_count')]), map: row[column('map_name')], round: row[column('round')] }))
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
export function setupServerStats(headers, rows) {
  const $ = id => document.getElementById(id);
  const points = populationSamples(headers, rows);
  const sessions = populationSessions(points);
  const date = time => new Date(time).toLocaleString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const svg = $('population-chart');
  const make = (tag, attrs = {}, text = '') => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.textContent = text;
    return node;
  };
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
    for (const point of durations) {
      const label = `${point.players} players · ${point.seconds} seconds (${(point.seconds / 60).toFixed(2)} minutes) · ${point.map} · round ${point.round}`;
      const dot = make('circle', { cx: x(point.players), cy: y(point.seconds), r: 4, class: 'population-dot duration-dot', tabindex: 0, 'aria-label': label });
      dot.append(make('title', {}, label));
      for (const event of ['pointerenter', 'focus', 'click']) dot.addEventListener(event, () => $('duration-detail').textContent = label);
      durationChart.append(dot);
    }
  }
  sessions.forEach((session, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `${date(session[0].time)} – ${date(session.at(-1).time)} UTC`;
    $('population-session').append(option);
  });
  $('population-coverage').textContent = `${points.length} timestamped samples · ${rows.length - points.length} rows without usable time/population omitted`;
  function render() {
    const selected = $('population-session').value;
    let visible = selected === 'all' ? points : sessions[Number(selected)];
    const range = Number($('population-range').value);
    if (range && visible.length) visible = visible.filter(point => point.time >= visible.at(-1).time - range * 3600000);
    svg.replaceChildren(make('title', {}, 'Server population over time'), make('desc', {}, 'Round-end samples. Long gaps have no connecting line; missing samples do not confirm zero players.'));
    $('population-empty').hidden = visible.length > 0;
    $('population-chart-wrap').hidden = !visible.length;
    if (!visible.length) return;
    const start = visible[0].time - (visible.length === 1 ? 60000 : 0);
    const end = visible.at(-1).time + (visible.length === 1 ? 60000 : 0);
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
        const label = `${date(point.time)} UTC · ${point.players} players · ${point.map} · round ${point.round}`;
        const dot = make('circle', { cx: x(point.time), cy: y(point.players), r: 4, class: 'population-dot', tabindex: 0, 'aria-label': label });
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
  for (const id of ['population-session', 'population-range', 'population-style']) $(id).addEventListener('change', render);
  render();
  return { count: points.length };
}
