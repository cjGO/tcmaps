import { sourceEqual, upperIndex } from './tactical-replay.js';
import { recordedVariantId } from './map-variants.js';
import { experimentalSamplesJoin } from './experimental-replay.js';

// Captured Napoleonic Wars troop classes; dismounting does not change role.
// Class 17 is ranged cavalry (dragoons); class 19 is heavy melee cavalry.
export const DENSITY_UNITS = [
  ['cavalry', 'Cav'], ['infantry', 'Inf'], ['light', 'Light'],
  ['rifles', 'Rifles'], ['artillery', 'Arty'], ['dragoons', 'Dragoons'], ['unknown', 'Unknown'],
];
export function densityUnit(meta) {
  const c = meta?.class;
  if (c === 12) return 'light';
  if (c === 13) return 'rifles';
  if (c === 17) return 'dragoons';
  if (c >= 14 && c <= 19) return 'cavalry';
  if (c === 20 || c === 21) return 'artillery';
  if ([10, 11, 22, 23].includes(c)) return 'infantry';
  return 'unknown';
}
function unitGrid(size) {
  return { movement: new Float64Array(size * size), deaths: new Float64Array(size * size), playerDeaths: new Float64Array(size * size), seconds: 0, deathCount: 0, playerDeathCount: 0 };
}
// Filter the cached grids without fetching or parsing recordings again.
export function selectDensity(result, units = DENSITY_UNITS.map(([id]) => id), deathKind = 'bot') {
  if (!result?.units) return result;
  const selected = { ...result, ...unitGrid(result.size) };
  for (const id of new Set(units)) {
    const grid = result.units[id];
    if (!grid) continue;
    selected.seconds += grid.seconds;
    selected.deathCount += (deathKind !== 'player' ? grid.deathCount : 0) + (deathKind !== 'bot' ? grid.playerDeathCount : 0);
    for (let i = 0; i < selected.movement.length; i++) {
      selected.movement[i] += grid.movement[i];
      selected.deaths[i] += (deathKind !== 'player' ? grid.deaths[i] : 0) + (deathKind !== 'bot' ? grid.playerDeaths[i] : 0);
    }
  }
  if (result.comparison) selected.comparison = Object.fromEntries(Object.entries(result.comparison).map(([key, grid]) => [key, selectDensity(grid, units, deathKind)]));
  return selected;
}

export const DENSITY_SIZE = 128;
export function createDensity(data, size = DENSITY_SIZE) {
  return { size, bounds: data.bounds, movement: new Float64Array(size * size), deaths: new Float64Array(size * size), seconds: 0, deathCount: 0, rounds: 0, units: Object.fromEntries(DENSITY_UNITS.map(([id]) => [id, unitGrid(size)])) };
}

// Weight observed intervals by elapsed time, splitting at control changes. Never
// extend a final pose or connect missing snapshots. Movement remains estimated.
export function densityRecordingMatches(recording, terrain) {
  if (recording.synthetic) return false;
  const sameMap = recording.map_id ? recording.map_id === terrain.map_id : recording.map === terrain.id;
  const variant = recordedVariantId(recording, terrain.map_id);
  if (terrain.comparisonVariant && !['source', terrain.comparisonVariant].includes(variant)) return false;
  return sameMap && (!terrain.selectedVariant || terrain.selectedVariant === 'all' || recordedVariantId(recording, terrain.map_id) === terrain.selectedVariant);
}

export function densityTerrainMatch(header, data, linkedMapId) {
  if (header.synthetic) return null;
  const map = header.map;
  if (data.comparisonVariant && !['source', data.comparisonVariant].includes(recordedVariantId(map, data.map_id))) return null;
  if (data.selectedVariant && data.selectedVariant !== 'all' && recordedVariantId(map, data.map_id) !== data.selectedVariant) return null;
  const mapId = map.map_id || /^(test_map_\d+)(?:_(?:RAW|Var[a-z0-9]+))?$/i.exec(map.map_name || '')?.[1] || linkedMapId;
  // Match map identity across source versions, then respect the selected variant.
  if (mapId && data.map_id) return mapId === data.map_id ? 'map' : null;
  return sourceEqual(map.source, data.source) ? 'exact' : null;
}

export function accumulateDensity(result, replay, data, experimental = false, linkedMapId) {
  if (!densityTerrainMatch(replay.header, data, linkedMapId)) return false;
  const { size, bounds: b } = result;
  const cell = Math.min(b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m) / size;
  function add(field, p, weight) {
    const x = (p.x - b.x_min_m) / (b.x_max_m - b.x_min_m), y = (p.y - b.y_min_m) / (b.y_max_m - b.y_min_m);
    if (x < 0 || x > 1 || y < 0 || y > 1) return false;
    field[Math.min(size - 1, Math.floor(y * size)) * size + Math.min(size - 1, Math.floor(x * size))] += weight;
    return true;
  }
  for (const track of replay.tracks.values()) {
    const death = experimental ? track.end.t : track.death;
    for (let i = 0; i + 1 < track.samples.length; i++) {
      const a = track.samples[i], z = track.samples[i + 1], dt = z.t - a.t;
      if (dt <= 0 || (experimental ? !experimentalSamplesJoin(a, z) : dt > replay.maxGap || z.index !== a.index + 1)) continue;
      const stop = Math.min(z.t, death);
      if (stop <= a.t) continue;
      const cuts = [a.t, ...track.changes.filter(m => m.t > a.t && m.t < stop).map(m => m.t), stop];
      const distance = Math.hypot(z.x - a.x, z.y - a.y);
      for (let j = 0; j + 1 < cuts.length; j++) {
        const begin = cuts[j], end = cuts[j + 1];
        const meta = track.changes[upperIndex(track.changes, begin)];
        if (meta?.kind !== 'player') continue;
        const grid = result.units[densityUnit(meta)];
        const steps = Math.max(1, Math.min(2000, Math.ceil(distance * (end - begin) / dt / (cell / 2))));
        const weight = (end - begin) / steps / 1000;
        for (let k = 0; k < steps; k++) {
          const u = (begin - a.t + (k + .5) * (end - begin) / steps) / dt;
          const point = { x: a.x + (z.x - a.x) * u, y: a.y + (z.y - a.y) * u };
          if (add(result.movement, point, weight)) {
            result.seconds += weight; grid.seconds += weight; add(grid.movement, point, weight);
          }
        }
      }
    }
    const isDeath = experimental ? track.end.type === 'death' : track.removalReason === 'death';
    const meta = track.changes[upperIndex(track.changes, death)];
    const pose = track.samples[upperIndex(track.samples, death)];
    if (isDeath && pose && ['bot', 'player'].includes(meta?.kind)) {
      const grid = result.units[densityUnit(meta)];
      if (meta.kind === 'bot' && add(result.deaths, pose, 1)) {
        result.deathCount++; grid.deathCount++; add(grid.deaths, pose, 1);
      } else if (meta.kind === 'player' && add(grid.playerDeaths, pose, 1)) grid.playerDeathCount++;
    }
  }
  result.rounds++;
  return true;
}

// Gaussian blur in world metres. Normalize each layer to its nonzero 95th
// percentile: a single camp/death pile cannot flatten the rest of the map.
export function smoothDensity(values, size, bounds, smoothing = 10) {
  let field = Float64Array.from(values);
  const spans = [bounds.x_max_m - bounds.x_min_m, bounds.y_max_m - bounds.y_min_m];
  for (let axis = 0; axis < 2; axis++) {
    const sigma = smoothing * size / spans[axis];
    if (sigma < .1) continue;
    const radius = Math.ceil(sigma * 3), kernel = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-.5 * ((k - radius) / sigma) ** 2));
    const sum = kernel.reduce((a, b) => a + b, 0), output = new Float64Array(field.length);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = axis === 0 ? x + k : x, yy = axis === 1 ? y + k : y;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) value += field[yy * size + xx] * kernel[k + radius] / sum;
      }
      output[y * size + x] = value;
    }
    field = output;
  }
  return field;
}

export function normalizedDensity(values, size, bounds, smoothing = 10, contrast = 1) {
  const field = smoothDensity(values, size, bounds, smoothing);
  const peak = field.reduce((a, b) => Math.max(a, b), 0);
  const occupied = [...field].filter(v => v > peak * .001).sort((a, b) => a - b);
  const reference = occupied[Math.ceil(occupied.length * .95) - 1] || 1;
  return Uint8Array.from(field, v => Math.round(255 * Math.min(1, v / reference) ** contrast));
}

// Compare physical values on one shared scale, before any display normalization.
// Positive = more on the variant; negative = more on RAW.
export function differenceDensity(comparison, metric, scale = 'per-recording', smoothing = 10, contrast = 1) {
  const { source, target } = comparison;
  const baseline = scale === 'totals' ? 1 : Math.max(1, source.rounds);
  const divisor = scale === 'totals' ? 1 : Math.max(1, target.rounds);
  const delta = Float64Array.from(target[metric], (value, i) => {
    const a = value / divisor, b = source[metric][i] / baseline, difference = a - b;
    return Math.abs(difference) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b)) ? 0 : difference;
  });
  const field = smoothDensity(delta, source.size, source.bounds, smoothing);
  const magnitudes = [...field].map(Math.abs);
  const peak = magnitudes.reduce((a, b) => Math.max(a, b), 0);
  const occupied = magnitudes.filter(v => v > peak * .001).sort((a, b) => a - b);
  const reference = occupied[Math.ceil(occupied.length * .95) - 1] || 1;
  const positive = new Uint8Array(field.length), negative = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) {
    const strength = Math.round(255 * Math.min(1, Math.abs(field[i]) / reference) ** contrast);
    (field[i] > 0 ? positive : negative)[i] = strength;
  }
  return { positive, negative };
}
