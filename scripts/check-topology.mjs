import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { terrainGeometry } from '../src/terrain-geometry.js';
import { parseMapNames } from '../src/map-identity.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async p => JSON.parse(await readFile(path.join(root, p), 'utf8'));
const manifest = await read('lib/rotation-topology.json');
const nameRows = parseMapNames(await readFile(path.join(root, 'MAPNAMES.md'), 'utf8'));
const names = new Map();
for (const { id, map_id } of nameRows) {
  if (names.has(id)) throw new Error('Duplicate MAPNAMES identity: ' + id);
  names.set(id, map_id);
}
const rotation = new Map((await read('lib/editor-rotation.json')).map(m => [m.id, m]));
const editors = new Map((await read('lib/editor-maps.json')).map(m => [m.id, m]));
if (manifest.schema_version !== 1 || manifest.maps.length !== manifest.map_count || !manifest.maps.length || new Set(manifest.maps.map(m => m.id)).size !== manifest.maps.length) throw new Error('Invalid topology manifest');
assert.deepEqual(manifest.maps.map(m => m.id), [...rotation.keys()], 'Height maps must cover every fixed rotation map');
for (const map of manifest.maps) {
  const current = rotation.get(map.id);
  if (!current || current.pool !== map.pool) throw new Error('Topology map is not registered: ' + map.id);
  for (const key of ['sco_sha256', 'recipe_sha256', 'terrain_code']) if (map.source[key] !== current.source[key]) throw new Error('Stale topology source: ' + map.id);
  const publicId = names.get(map.id);
  assert.equal(map.map_id, publicId, 'Topology must follow MAPNAMES.md');
  assert.equal(current.map_id, publicId, 'Rotation must follow MAPNAMES.md');
  assert.match(publicId || '', /^test_map_\d+$/);
  const mapName = publicId + '_RAW';
  assert.equal(map.map_name, mapName, 'Topology must use the public RAW map name');
  if (map.url !== `/topology/${mapName}/${map.sha256.slice(0,20)}/${mapName}.json`) throw new Error('Invalid topology path');
  const bytes = await readFile(path.join(root, 'public', map.url));
  if (createHash('sha256').update(bytes).digest('hex') !== map.sha256) throw new Error('Topology checksum changed');
  const data = JSON.parse(bytes);
  if (data.id !== map.id || data.height_data_sha256 !== map.height_data_sha256) throw new Error('Topology measurement identity differs');
  const project = await read('public/' + editors.get(map.id).project);
  assert.equal(data.height_data_sha256, project.height_data_sha256, 'Terrain and editor must use the same measured grid');
  assert.deepEqual(data.bounds, project.bounds);
  for (const key of ['sco_sha256', 'recipe_sha256', 'terrain_code']) if (data.source[key] !== map.source[key]) throw new Error('Topology model source differs');
  terrainGeometry(data);
  if (data.spawns.length !== 2 || data.spawns[0].entry !== 0 || data.spawns[1].entry !== 32) throw new Error('Missing original spawns');
}
console.log(`Verified ${manifest.maps.length} measured topology model(s) against the registered rotation.`);
