import { normalizedDensity } from './rotation-density.js';
import { scatterRandom } from './editor-scatter.js';

export function heatLayoutField(data, variant, metric, smoothing) {
  const { size, bounds, groups } = data;
  const movement = new Float64Array(size * size), deaths = new Float64Array(size * size);
  let rounds = 0, playerSeconds = 0, deathCount = 0;
  for (const group of groups) {
    if (variant && variant !== group.variant) continue;
    rounds += group.rounds;
    for (const [index, milliseconds, players, bots] of group.cells) {
      const seconds = milliseconds / 1000;
      const count = metric === 'playerDeaths' ? players : metric === 'botDeaths' ? bots : players + bots;
      movement[index] += seconds;
      deaths[index] += count;
      playerSeconds += seconds;
      deathCount += count;
    }
  }
  // Normalize each signal independently so movement seconds and death counts have equal influence.
  const layers = [];
  if (playerSeconds && ['movement', 'both'].includes(metric)) layers.push(normalizedDensity(movement, size, bounds, smoothing));
  if (deathCount && metric !== 'movement') layers.push(normalizedDensity(deaths, size, bounds, smoothing));
  const values = new Float64Array(size * size);
  for (const layer of layers) for (let i = 0; i < values.length; i++) values[i] += layer[i] / (255 * layers.length);
  return { size, bounds, values, rounds, playerSeconds, deathCount };
}

export function generateHeatLayout({ size, bounds, values }, { count, spacing, seed, existing, spawns = [] }) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Choose between 1 and 1000 assets.');
  if (!Number.isFinite(spacing) || spacing < 0 || spacing > 200) throw new Error('Spacing must be between 0 and 200 metres.');
  const limit = Math.min(count, Math.max(0, 10000 - existing.length));
  const random = scatterRandom(seed), points = [], occupied = new Map(), density = [];
  let total = 0;
  for (const [index, value] of values.entries()) {
    if (value <= 0) continue;
    // Favor hotspot cores while retaining a chance to sample their outskirts.
    total += value * value;
    density.push({ index, total });
  }
  if (!density.length || !limit) return points;

  const gridSize = Math.max(spacing, .001);
  const key = (x, y) => `${x},${y}`;
  function add(point) {
    const cell = key(Math.floor(point.x_m / gridSize), Math.floor(point.y_m / gridSize));
    if (!occupied.has(cell)) occupied.set(cell, []);
    occupied.get(cell).push(point);
  }
  existing.forEach(add);
  spawns.forEach(add);
  function hasSpace(x, y) {
    const col = Math.floor(x / gridSize), row = Math.floor(y / gridSize);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbors = occupied.get(key(col + dx, row + dy));
      if (neighbors?.some(p => Math.hypot(p.x_m - x, p.y_m - y) < gridSize)) return false;
    }
    return true;
  }

  const width = (bounds.x_max_m - bounds.x_min_m) / size, height = (bounds.y_max_m - bounds.y_min_m) / size;
  const attempts = Math.min(100000, Math.max(2000, limit * 150));
  for (let attempt = 0; attempt < attempts && points.length < limit; attempt++) {
    const weight = random() * total;
    let low = 0, high = density.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (density[middle].total > weight) high = middle;
      else low = middle + 1;
    }
    const { index } = density[low];
    const x = bounds.x_min_m + (index % size + random()) * width;
    const y = bounds.y_min_m + (Math.floor(index / size) + random()) * height;
    const x_m = Math.round(x * 1000) / 1000, y_m = Math.round(y * 1000) / 1000;
    if (x_m < bounds.x_min_m || x_m > bounds.x_max_m || y_m < bounds.y_min_m || y_m > bounds.y_max_m || !hasSpace(x_m, y_m)) continue;
    const point = { x_m, y_m };
    points.push(point);
    add(point);
  }
  return points;
}
