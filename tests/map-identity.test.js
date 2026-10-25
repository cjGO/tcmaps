import test from 'node:test';
import assert from 'node:assert/strict';
import { publicMapId, mapLabel, csvRows } from '../src/map-identity.js';
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
