import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publicMapId, mapLabel, csvRows, parseMapNames, statsMapId } from '../src/map-identity.js';
test('slot reassignment changes only lookup, never historical identity', () => {
 const old=[{id:'scn_mp_custom_map_1',map_id:'test_map_128',variant_id:'village.json'}];
 const fresh=[{id:'scn_mp_custom_map_1',map_id:'test_map_145',variant_id:'source'}];
 assert.equal(publicMapId(old,'scn_mp_custom_map_1.png'),'test_map_128');
 assert.equal(publicMapId(fresh,'scn_mp_custom_map_1.png'),'test_map_145');
 assert.equal(publicMapId(fresh,'test_map_128.png'),'test_map_128');
 assert.equal(mapLabel(old,'scn_mp_custom_map_1.png'),'test_map_128 · village.json');
 assert.equal(publicMapId([], 'scn_mp_custom_map_1.png'),null);
});
test('variant CSV accepts commas and quoted newlines', () => {
 assert.deepEqual(csvRows('map,variant\ntest_map_128,"a,b.json"\n'),[['map','variant'],['test_map_128','a,b.json']]);
 assert.deepEqual(csvRows('a,"b\nc"\n'),[['a','b\nc']]);
});
test('installed names resolve slots and recorded variants without guessing unknown slots', () => {
 const maps = parseMapNames('| Installed slot | Map | Size | Variants folder |\r\n|---|---|---|---|\r\n| mp_custom_map_1 | test_map_107 | small | [variants](small/test_map_107/variants/) |\r\n');
 assert.deepEqual(maps, [{ id: 'scn_mp_custom_map_1', filename: 'scn_mp_custom_map_1.png', map_id: 'test_map_107', pool: 'small' }]);
 for (const name of ['mp_custom_map_1', 'scn_mp_custom_map_1.png', 'test_map_107', 'test_map_107_RAW', 'test_map_107_VarA']) assert.equal(statsMapId(maps, name), 'test_map_107');
 for (const name of ['mp_custom_map_2', 'legacy_mp_custom_map_1', 'test_map_107_unknown', 'random_multi_plain']) assert.equal(statsMapId(maps, name), name);
 assert.equal(statsMapId(maps, 'test_map_128_RAW'), 'test_map_128');
});
test('MAPNAMES agrees with all registered previews and restores stats for every active map', () => {
 const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
 const maps = parseMapNames(read('MAPNAMES.md'));
 const registry = JSON.parse(read('lib/editor-rotation.json'));
 assert.equal(maps.length, registry.length);
 assert.equal(new Set(maps.map(map => map.id)).size, maps.length);
 const [headers, ...rows] = csvRows(read('map_round_stats.csv'));
 const names = rows.map(row => statsMapId(maps, row[headers.indexOf('map_name')]));
 for (const map of maps) {
  const registered = registry.find(row => row.id === map.id);
  assert.equal(map.map_id, registered?.map_id);
  assert.equal(map.pool, registered?.pool);
  assert.ok(names.includes(map.map_id), `Missing statistics for ${map.map_id}`);
 }
});
