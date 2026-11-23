import manifest from '../lib/replay-heat.json' with { type: 'json' };
import { createDensity, DENSITY_SIZE } from './rotation-density.js';

const cache = new Map();
const boundsMatch = (a, b) => Object.keys(a).every(key => a[key] === b[key]);

export function preparedHeatLoader(mapId, bounds, base = import.meta.env?.BASE_URL ?? '/') {
  const entry = manifest.maps[mapId];
  if (!entry || !boundsMatch(entry.bounds, bounds)) return null;
  return () => {
    const url = `${base}replay-heat/${entry.filename}`;
    if (cache.has(url)) {
      const pending = cache.get(url);
      cache.delete(url);
      cache.set(url, pending);
      return pending;
    }
    const pending = fetch(url, { signal: AbortSignal.timeout(30_000) }).then(async response => {
      if (!response.ok) throw new Error('The prepared heatmap file could not load.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Fetch already decodes Content-Encoding if the static host sends it.
      const json = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
        : JSON.parse(new TextDecoder().decode(bytes));
      if (json.size !== DENSITY_SIZE || !boundsMatch(entry.bounds, json.bounds) || !Array.isArray(json.groups) || !json.groups.length) {
        throw new Error('The heatmap does not match this terrain.');
      }
      return json;
    }).catch(error => {
      if (cache.get(url) === pending) cache.delete(url);
      throw error;
    });
    cache.set(url, pending);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    return pending;
  };
}

export function densityFromPreparedHeat(data, variant = 'all', comparisonVariant) {
  function grid(groups) {
    const result = createDensity(data, data.size);
    for (const group of groups) {
      result.rounds += group.rounds;
      for (const [unit, cells] of Object.entries(group.units)) {
        const field = result.units[unit];
        for (const [index, milliseconds, players, bots] of cells) {
          const seconds = milliseconds / 1000;
          field.movement[index] += seconds;
          field.playerDeaths[index] += players;
          field.deaths[index] += bots;
          field.seconds += seconds;
          field.playerDeathCount += players;
          field.deathCount += bots;
          result.movement[index] += seconds;
          result.deaths[index] += bots;
          result.seconds += seconds;
          result.deathCount += bots;
        }
      }
    }
    return result;
  }
  const groups = data.groups;
  if (!comparisonVariant) return grid(variant === 'all' ? groups : groups.filter(group => group.variant === variant));
  const source = groups.filter(group => group.variant === 'source');
  const target = groups.filter(group => group.variant === comparisonVariant);
  return { ...grid([...source, ...target]), comparison: { source: grid(source), target: grid(target) } };
}
