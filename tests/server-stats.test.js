import test from 'node:test';
import assert from 'node:assert/strict';
import { populationSamples, populationSessions, durationSamples, durationColor, durationRegression, durationJitter, setupServerStats } from '../src/server-stats.js';
const headers = ['map_name', 'round', 'player_count', 'timestamp_utc'];
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
    assert.match(fit.getAttribute('aria-label'), /Quadratic regression · R²/);
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
