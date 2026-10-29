import { groundHeight } from './editor-spatial.js';
import { displayedHeight } from './terrain-geometry.js';

// Display-only placement. Recorded poses, combat effects and projectile paths
// remain untouched. Keep above-ground poses (bridges, riders, jumps) intact.
export function replayHeight(data, p, scale, terrain = true) {
  const height = terrain ? Math.max(p.z, groundHeight(data, p.x, p.y)) : p.z;
  return displayedHeight(height, data.min_height_m, scale);
}

function cell(axis, value) {
  let lo = 0, hi = axis.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (axis[mid] <= value) lo = mid; else hi = mid; }
  return lo;
}

// Split at the actual terrain triangle edges, not just at sample endpoints:
// a single chord between two ground positions can pass through a whole hill.
export function terrainTrail(data, from, to, terrain = true) {
  if (!terrain) return [from, to];
  const dx = to.x - from.x, dy = to.y - from.y, cuts = [0, 1];
  for (const [axis, start, delta] of [[data.xs, from.x, dx], [data.ys, from.y, dy]]) {
    if (!delta) continue;
    const low = Math.min(start, start + delta), high = Math.max(start, start + delta);
    for (let i = cell(axis, low); i < axis.length && axis[i] < high; i++) {
      const t = (axis[i] - start) / delta;
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  const diagonals = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const mid = (cuts[k] + cuts[k + 1]) / 2;
    const x = from.x + dx * mid, y = from.y + dy * mid;
    // Outside the measured bounds groundHeight extends the boundary height.
    if (x < data.xs[0] || x > data.xs.at(-1) || y < data.ys[0] || y > data.ys.at(-1)) continue;
    const i = cell(data.xs, x), j = cell(data.ys, y);
    const width = data.xs[i + 1] - data.xs[i], height = data.ys[j + 1] - data.ys[j];
    const slope = dx / width + dy / height;
    if (!slope) continue;
    const t = (1 - (from.x - data.xs[i]) / width - (from.y - data.ys[j]) / height) / slope;
    if (t > cuts[k] && t < cuts[k + 1]) diagonals.push(t);
  }
  return [...new Set([...cuts, ...diagonals])].sort((a, b) => a - b).map(t => {
    const p = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + (to.z - from.z) * t };
    p.z = Math.max(p.z, groundHeight(data, p.x, p.y));
    return p;
  });
}
