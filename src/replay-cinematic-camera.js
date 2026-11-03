import { soldierAt, upperIndex } from './tactical-replay.js';
import { entityAt } from './experimental-replay.js';
import { groundHeight } from './editor-spatial.js';
import { displayedHeight } from './terrain-geometry.js';

export const CINEMATIC_DEFAULTS = Object.freeze({ orbit: 2, elevation: 45, context: 35, smoothing: 6 });
export function cinematicSettings(value = {}) {
  const limits = { orbit: [-6, 6], elevation: [25, 75], context: [0, 100], smoothing: [2, 20] };
  return Object.fromEntries(Object.entries(CINEMATIC_DEFAULTS).map(([key, fallback]) => {
    const n = Number(value[key] ?? fallback), [min, max] = limits[key];
    return [key, Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback];
  }));
}

// A timeline-derived path, independent of frame rate, seek order and clip start.
// B-spline blending gives continuous velocity without keeping playback history.
export function createCinematicCamera(replay, data) {
  const experimental = replay.header.schema === 'warband-experimental-replay';
  const first = replay.first, last = replay.coverageEnd ?? replay.last, b = data.bounds;
  const cx = (b.x_min_m + b.x_max_m) / 2, cy = (b.y_min_m + b.y_max_m) / 2;
  const span = Math.max(1, b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m);
  const mapRadius = Math.hypot(b.x_max_m - cx, b.y_max_m - cy);
  const cache = new Map(), cellSize = Math.max(20, span / 10);
  function focusAt(time) {
    const t = Math.max(first, Math.min(last, time));
    if (cache.has(t)) return cache.get(t);
    const points = [], cells = new Map();
    for (const track of replay.tracks.values()) {
      const point = experimental ? entityAt(track, t) : soldierAt(track, t, replay);
      if (point && point.kind !== 'horse') points.push({ ...point, weight: 1 });
      const death = experimental ? track.end.t : track.death;
      const died = experimental ? track.end.type === 'death' : track.removalReason === 'death';
      if (died && t >= death && t - death < 8000) {
        const sample = track.samples[upperIndex(track.samples, death)];
        if (sample && death - sample.t < 10000) points.push({ ...sample, team: -1, weight: 6 * (1 - (t - death) / 8000) });
      }
    }
    for (const p of points) {
      p.gx = Math.floor(p.x / cellSize); p.gy = Math.floor(p.y / cellSize);
      const key = `${p.gx},${p.gy}`;
      if (!cells.has(key)) cells.set(key, new Map());
      const teams = cells.get(key); teams.set(p.team, (teams.get(p.team) || 0) + 1);
    }
    let total = 0, x = 0, y = 0;
    for (const p of points) {
      let enemies = 0;
      if (p.team >= 0) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const [team, count] of cells.get(`${p.gx + dx},${p.gy + dy}`) || []) if (team >= 0 && team !== p.team) enemies += count;
      }
      p.weight += Math.min(16, enemies * 2);
      total += p.weight; x += p.x * p.weight; y += p.y * p.weight;
    }
    x = total ? x / total : cx; y = total ? y / total : cy;
    const variance = points.reduce((sum, p) => sum + p.weight * ((p.x - x) ** 2 + (p.y - y) ** 2), 0);
    const radius = total ? Math.max(span * .10, Math.min(mapRadius, 2 * Math.sqrt(variance / total))) : mapRadius;
    const result = { x, y, radius };
    // Bound memory even when scrubbing a long recording with many settings.
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(t, result); return result;
  }
  return {
    at(time, options = {}) {
      const settings = cinematicSettings(options.settings), scale = options.scale ?? 1;
      const t = Math.max(first, Math.min(last, time)), step = settings.smoothing * 1000;
      const phase = (t - first) / step, index = Math.floor(phase), u = phase - index;
      const weights = [(1 - u) ** 3 / 6, (3 * u ** 3 - 6 * u ** 2 + 4) / 6,
        (-3 * u ** 3 + 3 * u ** 2 + 3 * u + 1) / 6, u ** 3 / 6];
      const focus = { x: 0, y: 0, radius: 0 };
      weights.forEach((weight, i) => {
        const sample = focusAt(first + (index + i - 1) * step);
        for (const key of Object.keys(focus)) focus[key] += sample[key] * weight;
      });
      const context = settings.context / 100;
      const x = focus.x * (1 - context) + cx * context, y = focus.y * (1 - context) + cy * context;
      const relief = (data.max_height_m - data.min_height_m) * scale;
      const z = h => displayedHeight(h, data.min_height_m, scale);
      const target = [x, y, z(groundHeight(data, x, y)) + Math.max(4, relief * .15)];
      const radius = Math.hypot(focus.radius * (1 - context) + mapRadius * context, relief / 2);
      const halfFov = Math.min(Math.PI / 8, Math.atan(Math.tan(Math.PI / 8) * Math.max(.1, options.aspect || 1)));
      const distance = Math.max(20, radius * 1.15 / Math.sin(halfFov));
      const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
      const yaw = (-50 + (t - first) / 1000 / speed * settings.orbit) * Math.PI / 180;
      const elevation = settings.elevation * Math.PI / 180;
      const position = [x + Math.cos(yaw) * Math.cos(elevation) * distance,
        y + Math.sin(yaw) * Math.cos(elevation) * distance, target[2] + Math.sin(elevation) * distance];
      // Keep the sightline above measured terrain, including exaggerated ridges.
      for (let i = 1; i <= 16; i++) {
        const f = i / 16, px = x + (position[0] - x) * f, py = y + (position[1] - y) * f;
        const floor = z(groundHeight(data, px, py)) + Math.max(3, span * .01);
        position[2] = Math.max(position[2], target[2] + (floor - target[2]) / f);
      }
      return { position, target, fov: 45 };
    },
  };
}
