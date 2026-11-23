import { readFile } from 'node:fs/promises';
import { DENSITY_SIZE, densityUnit, visitReplayDensity } from '../src/rotation-density.js';
import { recordedVariantId } from '../src/map-variants.js';

const sourceKey = source => source?.terrain_code && source?.sco_sha256 && source?.recipe_sha256
  ? JSON.stringify([source.sco_sha256, source.recipe_sha256, source.terrain_code]) : null;

export function createEditorHeatArchive(editorMaps, archivedMaps) {
  const maps = new Map(editorMaps.map(map => [map.map_id, map]));
  const sources = new Map();
  const terrainCodes = new Map();
  for (const map of [...editorMaps, ...archivedMaps]) {
    const key = sourceKey(map.source);
    if (!key) continue;
    const matches = sources.get(key) ?? [];
    matches.push(map);
    sources.set(key, matches);
    const code = map.source.terrain_code.toLowerCase();
    const ids = terrainCodes.get(code) ?? new Set();
    ids.add(map.map_id);
    terrainCodes.set(code, ids);
  }
  const results = new Map();
  const seen = new Set();
  const size = DENSITY_SIZE;
  function mapIdentity(recorded) {
    const matches = sources.get(sourceKey(recorded.source)) ?? [];
    const exactMapIds = new Set(matches.map(map => map.map_id));
    const name = (recorded.map_name || recorded.id || '').replace(/^scn_/i, '');
    const named = /^(test_map_\d+)(?:_|$)/i.exec(name)?.[1].toLowerCase();
    const codeIds = terrainCodes.get(recorded.source?.terrain_code?.toLowerCase());
    // Scene slots are reused. A legacy capture needs an exact source or a unique terrain code.
    const inferred = exactMapIds.size === 1 ? matches[0].map_id : codeIds?.size === 1 ? [...codeIds][0] : null;
    return { mapId: recorded.map_id || named || inferred, matches, name };
  }
  function grid() {
    return { movement: new Float64Array(size * size),
      playerDeaths: new Uint32Array(size * size), botDeaths: new Uint32Array(size * size) };
  }
  function sparse({ movement, playerDeaths, botDeaths }) {
    const cells = [];
    for (let i = 0; i < movement.length; i++) {
      if (movement[i] || playerDeaths[i] || botDeaths[i]) cells.push([i,
        movement[i] ? Math.max(1, Math.round(movement[i] * 1000)) : 0, playerDeaths[i], botDeaths[i]]);
    }
    return cells;
  }
  return {
    accepts(header) { return !header.synthetic && maps.has(mapIdentity(header.map).mapId); },
    add(replay, experimental) {
      const { header } = replay;
      if (header.synthetic) return;
      const recorded = header.map;
      const { mapId, matches, name } = mapIdentity(recorded);
      const map = maps.get(mapId);
      if (!map) return;
      const key = JSON.stringify([mapId, header.id]);
      if (seen.has(key)) return;
      const variantIds = new Set(matches.filter(map => map.map_id === mapId).map(map => recordedVariantId(map, mapId)));
      const explicitVariant = recorded.variant_id || recorded.variant_filename || name.toLowerCase().startsWith(`${mapId}_`);
      const variant = explicitVariant ? recordedVariantId({ ...recorded, map_name: name }, mapId)
        : variantIds.size === 1 ? [...variantIds][0] : 'unidentified';
      const groups = results.get(mapId) ?? new Map();
      const group = groups.get(variant) ?? { variant, rounds: 0, ...grid(), units: new Map() };
      function unitGrid(meta) {
        const unit = densityUnit(meta);
        if (!group.units.has(unit)) group.units.set(unit, grid());
        return group.units.get(unit);
      }
      let usable = false;
      visitReplayDensity(replay, map.bounds, size, experimental, {
        movement(index, weight, meta) {
          group.movement[index] += weight;
          unitGrid(meta).movement[index] += weight;
          usable = true;
        },
        death(index, meta) {
          const field = meta.kind === 'player' ? 'playerDeaths' : 'botDeaths';
          group[field][index]++;
          unitGrid(meta)[field][index]++;
          usable = true;
        },
      });
      if (!usable) return;
      seen.add(key);
      group.rounds++;
      groups.set(variant, group);
      results.set(mapId, groups);
    },
    finish() {
      return Object.fromEntries([...results].sort(([a], [b]) => a.localeCompare(b)).map(([mapId, groups]) => [
        mapId, { size, bounds: maps.get(mapId).bounds, groups: [...groups.values()]
          .sort((a, b) => a.variant.localeCompare(b.variant))
          .map(group => {
            const { variant, rounds } = group;
            return { variant, rounds, cells: sparse(group),
              units: Object.fromEntries([...group.units].sort().map(([unit, grid]) => [unit, sparse(grid)])) };
          }) },
      ]));
    },
  };
}

export async function openEditorHeatArchive(root) {
  const [editor, archive] = await Promise.all(['rotation-topology', 'replay-topology'].map(async file => {
    const path = new URL(`../lib/${file}.json`, root);
    const data = await readFile(path, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '{"maps":[]}';
      throw error;
    });
    return JSON.parse(data).maps;
  }));
  return createEditorHeatArchive(editor, archive);
}
