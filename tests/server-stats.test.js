import test from 'node:test';
import assert from 'node:assert/strict';
import { populationSamples, populationSessions, weeklyPopulation, durationSamples, durationColor, durationRegression, durationSpline, durationJitter, setupServerStats } from '../src/server-stats.js';
const headers = ['map_name', 'round', 'player_count', 'timestamp_utc'];
test('unique player chart switches between daily totals and deduplicated weekly totals', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const el = id => document.getElementById(id);
  try {
    setupServerStats([], [], [
      { day: '2026-10-07', players: 2 }, { day: '2026-10-08', players: 2 },
    ], [
      { start: '2026-10-01', day: '2026-10-07', players: 2 },
      { start: '2026-10-02', day: '2026-10-08', players: 3 },
    ]);
    assert.match(el('weekly-players-summary').textContent, /Past 7 days: 3 unique players · 2026-10-02 – 2026-10-08/);
    const chart = el('daily-players-chart');
    assert.equal(chart.querySelectorAll('.daily-player-bar').length, 2);
    const selector = el('daily-players-view');
    selector.value = 'weekly';
    selector.dispatchEvent(new dom.window.Event('change'));
    assert.equal(el('weekly-players-note').hidden, false);
    assert.equal(chart.querySelectorAll('.daily-player-bar').length, 2);
    chart.querySelectorAll('.daily-player-bar')[1].dispatchEvent(new dom.window.Event('focus'));
    assert.equal(el('daily-players-detail').textContent, '2026-10-02 – 2026-10-08 UTC · 3 unique players');
    assert.match(chart.getAttribute('aria-label'), /Rolling 7-day/);
    selector.value = 'daily';
    selector.dispatchEvent(new dom.window.Event('change'));
    assert.equal(el('weekly-players-note').hidden, true);
    assert.match(chart.querySelectorAll('.daily-player-bar')[1].getAttribute('aria-label'), /2 unique players/);
    setupServerStats([], []);
    assert.equal(el('daily-players-chart-wrap').hidden, true);
    assert.equal(el('weekly-players-summary').textContent, '');
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test('weekly population matches UTC weekday/hour across weeks, weights rounds and preserves missing hours', () => {
  const points = [
    ['2026-10-01T10:00:00Z', 30],
    ['2026-10-08T10:05:00Z', 0],
    ['2026-10-08T10:55:00Z', 6],
    ['2026-10-08T12:15:00Z', 4],
  ].map(([time, players]) => ({ time: Date.parse(time), players }));
  const week = weeklyPopulation(points);
  assert.equal(week.length, 168);
  assert.equal(week[0].time, Date.parse('2026-10-01T13:00:00Z'));
  assert.equal(week.at(-3).players, 3);
  assert.equal(week.at(-3).count, 2);
  assert.equal(week.at(-3).average, 12);
  assert.equal(week.at(-3).averageCount, 3);
  assert.equal(week.at(-2).players, null);
  assert.equal(week.at(-2).average, null);
  assert.equal(week.at(-1).players, 4);
  assert.deepEqual(weeklyPopulation([]), []);
  assert.equal(weeklyPopulation([{ time: points[0].time, players: 0 }]).at(-1).players, 0);
});

test('weekly view overlays history, breaks gaps, toggles overlay and restores timeline controls', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const el = id => document.getElementById(`population-${id}`);
  const change = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new dom.window.Event('change'));
  };
  try {
    setupServerStats(headers, [
      ['map', '1', '30', '2026-10-01T10:00:00Z'],
      ['map', '2', '0', '2026-10-08T10:05:00Z'],
      ['map', '3', '6', '2026-10-08T10:55:00Z'],
      ['map', '4', '4', '2026-10-08T12:15:00Z'],
    ]);
    change('view', 'weekly');
    assert.equal(el('session').disabled, true);
    assert.equal(el('range').disabled, true);
    assert.equal(el('weekly-note').hidden, false);
    assert.equal(el('chart').querySelectorAll('circle.population-week').length, 2);
    assert.equal(el('chart').querySelectorAll('circle.population-average').length, 2);
    assert.equal(el('chart').querySelectorAll('polyline.population-week').length, 2);
    assert.ok([...el('chart').querySelectorAll('polyline')].every(line => line.getAttribute('points').split(' ').length === 1));
    el('chart').querySelector('circle.population-average').dispatchEvent(new dom.window.Event('focus'));
    assert.match(el('detail').textContent, /12.00 players · 3 rounds/);
    assert.match(el('summary').textContent, /3 rounds · Weekly average from all 4 recorded rounds/);
    el('average').checked = false;
    el('average').dispatchEvent(new dom.window.Event('change'));
    assert.equal(el('chart').querySelectorAll('.population-average').length, 0);
    assert.equal(el('chart').querySelectorAll('circle.population-week').length, 2);
    change('style', 'scatter');
    assert.equal(el('chart').querySelectorAll('polyline').length, 0);
    change('view', 'timeline');
    assert.equal(el('range').disabled, false);
    assert.equal(el('session').disabled, false);
    assert.equal(el('weekly-note').hidden, true);
    assert.equal(el('chart').querySelectorAll('circle').length, 3);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});
test('duration gradient distinguishes short, middle, long and unavailable durations', () => {
  assert.equal(durationColor(0, 120), 'rgb(37, 99, 235)');
  assert.equal(durationColor(60, 120), 'rgb(136, 94, 124)');
  assert.equal(durationColor(120, 120), 'rgb(234, 88, 12)');
  assert.equal(durationColor(null, 120), '#8a9588');
  assert.equal(durationColor(0, 0), 'rgb(37, 99, 235)');
});
test('population samples retain points with missing durations without coloring them as zero', () => {
  const columns = [...headers, 'duration_seconds'];
  const points = populationSamples(columns, ['0', '120', '', '-1', 'invalid'].map((duration, index) => ['map', String(index), '2', '2026-10-01T12:00:00Z', duration]));
  assert.deepEqual(points.map(point => point.seconds), [0, 120, null, null, null]);
});
test('duration samples include untimestamped rounds and zero values, excluding invalid or missing counts/durations', () => {
  const columns = ['map_name', 'round', 'player_count', 'duration_seconds'];
  const points = durationSamples(columns, [
    ['map', '1', '5', '120'], ['map', '2', '0', '0'],
    ['map', '3', '', '120'], ['map', '4', '2', ''],
    ['map', '5', '-1', '120'], ['map', '6', '2', '-10'],
    ['map', '7', '2.5', '120'], ['map', '8', '2', 'invalid'],
  ]);
  assert.deepEqual(points.map(({ players, seconds }) => [players, seconds]), [[5, 120], [0, 0]]);
  assert.deepEqual(durationSamples([], [['map']]), []);
});
test('preserves zero counts, sorts timestamps and excludes missing or invalid data', () => {
  const points = populationSamples(headers, [
    ['map', '1', '3', '2026-10-01T12:00:00Z'],
    ['map', '2', '0', '2026-10-01T11:00:00Z'],
    ['map', '3', '2', ''], ['map', '4', '', '2026-10-01T13:00:00Z'],
    ['map', '5', '-1', '2026-10-01T13:00:00Z'],
  ]);
  assert.deepEqual(points.map(p => p.players), [0, 3]);
});
test('breaks long gaps without inventing zero-player samples', () => {
  const points = [0, 30, 61, 62].map(minutes => ({ time: minutes * 60000, players: 5 }));
  assert.deepEqual(populationSessions(points).map(group => group.length), [2, 2]);
  assert.deepEqual(populationSessions([]), []);
});

test('duration regression recovers a quadratic and handles sparse player counts', () => {
  const points = [0, 1, 2, 4, 10, 30].map(players => ({ players, seconds: 120 + 30 * players + 2 * players ** 2 }));
  const fit = durationRegression(points);
  assert.equal(fit.degree, 2);
  for (const players of [0, 3, 15, 30]) assert.ok(Math.abs(fit.predict(players) - (120 + 30 * players + 2 * players ** 2)) < 1e-8);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-10);
  assert.equal(durationRegression([]), null);
  const constant = durationRegression([{ players: 4, seconds: 60 }, { players: 4, seconds: 120 }]);
  assert.equal(constant.degree, 0);
  assert.equal(constant.predict(4), 90);
  const linear = durationRegression([{ players: 1, seconds: 60 }, { players: 3, seconds: 120 }]);
  assert.equal(linear.degree, 1);
  assert.equal(linear.predict(2), 90);
});
test('duration regression weights each round, including duplicate player counts', () => {
  const points = [[0, 60], [0, 120], [1, 200], [2, 150], [3, 400], [3, 500]].map(([players, seconds]) => ({ players, seconds }));
  const fit = durationRegression(points);
  for (const power of [0, 1, 2]) {
    const residual = points.reduce((sum, p) => sum + (p.seconds - fit.predict(p.players)) * p.players ** power, 0);
    assert.ok(Math.abs(residual) < 1e-8);
  }
  assert.ok(fit.r2 > 0 && fit.r2 < 1);
});
test('duration jitter is small, deterministic and separates identical observations', () => {
  const offsets = Array.from({ length: 1000 }, (_, i) => durationJitter(i));
  assert.ok(offsets.every(value => Math.abs(value) <= .18));
  assert.equal(new Set(offsets).size, offsets.length);
  assert.equal(durationJitter(42), offsets[42]);
});
test('duration chart shows jitter and regression while preserving original point details', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    setupServerStats(['map_name', 'round', 'player_count', 'duration_seconds'], [
      ['map', '1', '2', '120'], ['map', '2', '2', '120'], ['map', '3', '4', '240'], ['map', '4', '6', '300']
    ]);
    const chart = document.getElementById('duration-chart');
    const dots = chart.querySelectorAll('.duration-dot');
    assert.equal(dots.length, 4);
    assert.notEqual(dots[0].getAttribute('cx'), dots[1].getAttribute('cx'));
    assert.equal(dots[0].getAttribute('cy'), dots[1].getAttribute('cy'));
    dots[0].dispatchEvent(new dom.window.Event('focus'));
    assert.match(document.getElementById('duration-detail').textContent, /^2 players · 120 seconds/);
    const fit = chart.querySelector('polyline.duration-fit');
    assert.equal(fit.getAttribute('points').split(' ').length, 201);
    assert.ok(!fit.getAttribute('points').includes('NaN'));
    assert.match(fit.getAttribute('aria-label'), /Natural cubic spline · 1 knot · R²/);
    const extension = chart.querySelector('polyline.duration-extrapolation');
    const coordinates = extension.getAttribute('points').split(' ').map(pair => pair.split(',').map(Number));
    assert.equal(extension.getAttribute('points').split(' ')[0], fit.getAttribute('points').split(' ').at(-1));
    assert.equal(coordinates.at(-1)[0], 950);
    assert.ok(coordinates.every(([x, y]) => Number.isFinite(x) && y >= 50 && y <= 350));
    assert.ok(chart.querySelector('.duration-extrapolation-region'));
    assert.match(document.getElementById('duration-summary').textContent, /50-player extrapolation:/);
    const selector = document.getElementById('duration-knots');
    assert.equal(selector.value, '2');
    selector.value = '5';
    selector.dispatchEvent(new dom.window.Event('change'));
    assert.equal(chart.querySelectorAll('.duration-dot').length, 4);
    assert.equal(chart.querySelectorAll('polyline.duration-extrapolation').length, 1);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test('population hours slider filters immediately and follows the selected session', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const el = id => document.getElementById(`population-${id}`);
  const count = () => el('chart').querySelectorAll('circle').length;
  const slide = hours => {
    el('range').value = String(hours);
    el('range').dispatchEvent(new dom.window.Event('input'));
  };
  try {
    setupServerStats([...headers, 'duration_seconds'], [
      ['map', '1', '3', '2026-10-01T10:00:00Z', '60'],
      ['map', '2', '8', '2026-10-01T10:10:00Z', '120'],
      ['map', '3', '12', '2026-10-01T10:20:00Z', '180'],
      ['map', '4', '5', '2026-10-02T10:05:00Z', '60']
    ]);
    assert.equal(count(), 3);
    slide(1);
    assert.equal(count(), 1);
    assert.equal(el('range-value').textContent, 'Past 1 hour');
    assert.equal(el('range').getAttribute('aria-valuetext'), 'Past 1 hour');
    slide(100);
    assert.equal(count(), 4);
    assert.equal(el('range-value').textContent, 'Past 100 hours');
    slide(24);
    assert.equal(count(), 3);
    el('session').value = '0';
    el('session').dispatchEvent(new dom.window.Event('change'));
    assert.equal(count(), 3);
    slide(1);
    assert.equal(count(), 3);
    assert.equal(document.querySelectorAll('.duration-dot').length, 4);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});


test('natural splines use evenly spaced knots and reproduce linear data with linear tails', () => {
  const points = Array.from({ length: 31 }, (_, players) => ({ players, seconds: 120 + 20 * players }));
  for (let count = 2; count <= 5; count++) {
    const fit = durationSpline(points, count);
    assert.equal(fit.knots.length, count);
    fit.knots.forEach((knot, i) => assert.ok(Math.abs(knot - 30 * (i + 1) / (count + 1)) < 1e-10));
    for (const players of [-5, 0, 7.5, 30, 40, 50]) {
      assert.ok(Math.abs(fit.predict(players) - (120 + 20 * players)) < 1e-6);
    }
    assert.ok(Math.abs(fit.r2 - 1) < 1e-10);
  }
});

test('natural spline tails stay linear, join smoothly, and weight each round', () => {
  const points = Array.from({ length: 31 }, (_, players) => ({ players, seconds: 150 + 300 * Math.sin(players / 15) }));
  points.push({ players: 10, seconds: 900 });
  for (let count = 2; count <= 5; count++) {
    const fit = durationSpline(points, count);
    assert.ok(Math.abs(fit.predict(50) - 2 * fit.predict(40) + fit.predict(30)) < 1e-6);
    for (const knot of [...fit.knots, fit.max]) {
      const h = 0.0001;
      const left = (fit.predict(knot) - fit.predict(knot - h)) / h;
      const right = (fit.predict(knot + h) - fit.predict(knot)) / h;
      assert.ok(Math.abs(left - right) < 0.01);
    }
    assert.ok(Math.abs(points.reduce((sum, p) => sum + p.seconds - fit.predict(p.players), 0)) < 1e-6);
  }
  assert.notEqual(durationSpline(points, 2).predict(15), durationSpline(points, 5).predict(15));
  assert.equal(durationSpline([]), null);
  assert.equal(durationSpline([{ players: 3, seconds: 60 }]).predict(50), 60);
  assert.equal(durationSpline([{ players: 1, seconds: 60 }, { players: 3, seconds: 120 }]).predict(5), 180);
});


test('all spline selector options refit the chart without duplicating observations', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    setupServerStats(['map_name', 'round', 'player_count', 'duration_seconds'],
      Array.from({ length: 31 }, (_, players) => ['map', String(players), String(players), String(150 + 300 * Math.sin(players / 15))]));
    const selector = document.getElementById('duration-knots');
    const chart = document.getElementById('duration-chart');
    const curves = new Set();
    for (const count of [2, 3, 4, 5]) {
      selector.value = String(count);
      selector.dispatchEvent(new dom.window.Event('change'));
      const fit = chart.querySelector('polyline.duration-fit');
      assert.ok(fit.getAttribute('aria-label').includes(count + ' knots'));
      curves.add(fit.getAttribute('points'));
      assert.equal(chart.querySelectorAll('.duration-dot').length, 31);
      assert.equal(chart.querySelectorAll('.duration-extrapolation-region').length, 1);
    }
    assert.equal(curves.size, 4);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});
