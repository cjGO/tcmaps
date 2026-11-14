import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sourceKey, editablePoints, validateRecord, backup, parseBackup, sweepCSV, setupSpawnSweep, STORAGE_KEY } from '../src/spawn-sweep.js';
const row = () => ({ map_id: 'test_map_107', scene_id: 'slot_1', source_variant: 'source', target_variant: 'SPAWNPOINT', source: { sco_sha256: 'a'.repeat(64), recipe_sha256: 'b'.repeat(64) }, bounds: { x_min_m: 0, x_max_m: 100, y_min_m: 0, y_max_m: 100 }, default_spawn_points: [{team:0,entry:0,x_m:10,y_m:50}, {team:1,entry:32,x_m:90,y_m:50}], spawn_points: [{team:0,entry:0,x_m:20,y_m:50}, {team:1,entry:32,x_m:80,y_m:50}], status:'reviewed' });
test('source identity survives rotation slot changes and separates RAW revisions', () => {
  const a = row(), b = {...a, scene_id:'slot_99'};
  assert.equal(sourceKey(a), sourceKey(b));
  assert.notEqual(sourceKey(a), sourceKey({...a,source:{...a.source,sco_sha256:'c'.repeat(64)}}));
});
test('backup preserves defaults, metadata and coordinates; CSV has two identified teams', () => {
  const r = row(), records = {[sourceKey(r)]:r};
  assert.deepEqual(parseBackup(backup(records)),records);
  assert.equal(sweepCSV(records).trim().split('\r\n').length,3);
  assert.match(sweepCSV(records), /SPAWNPOINT/);
  assert.deepEqual(editablePoints([{...r.spawn_points[0],x_m:20.123456,z_m:9}])[0], {...r.spawn_points[0],x_m:20.123});
});
test('reject invalid identities, duplicate records, out of bounds, missing teams and precision loss', () => {
  for (const mutate of [r=>r.spawn_points[0].x_m=-1,r=>r.spawn_points[1].entry=0,r=>r.spawn_points[0].x_m=null,r=>r.spawn_points[0].x_m=1.1234,r=>r.source.sco_sha256='',r=>r.spawn_points[1]={...r.spawn_points[0],team:1,entry:32}]) {
    const r = row(); mutate(r); assert.throws(()=>validateRecord(r));
  }
  assert.throws(()=>parseBackup(JSON.stringify({schema:'rate-maps.spawn-sweep',version:1,maps:[row(),row()]})));
});
test('UI saves edits, restores after navigation, and keeps reviewed flag only until next edit', () => {
  const dom = new JSDOM('<div id="panel"></div><button id="rotation-next"></button>', {url:'https://maps.test'});
  globalThis.document=dom.window.document; globalThis.localStorage=dom.window.localStorage;
  const r=row(), terrain={...r,sha256:'c'.repeat(64)}, data={bounds:r.bounds,spawns:r.default_spawn_points,xs:[0,100],ys:[0,100],grid_size:2,heights_mm:[0,0,0,0]};
  const viewer={canvas:document.createElement('canvas'),updateSpawns(){},exitExplorer(){},navigation(){}};
  const panel=document.getElementById('panel');
  const sweep=setupSpawnSweep(panel,()=>{},()=>[terrain]);
  panel.querySelector('[data-enable]').checked=true; sweep.attach(terrain,data,viewer);
  const x=panel.querySelector('[data-x="0"]'); x.value='25.125'; x.dispatchEvent(new dom.window.Event('change'));
  assert.equal(parseBackup(localStorage.getItem(STORAGE_KEY))[sourceKey(r)].spawn_points[0].x_m,25.125);
  panel.querySelector('[data-reviewed]').click();
  assert.equal(parseBackup(localStorage.getItem(STORAGE_KEY))[sourceKey(r)].status,'reviewed');
  sweep.clear(); sweep.attach(terrain,data,viewer); assert.equal(x.value,'25.125');
  x.value='26'; x.dispatchEvent(new dom.window.Event('change'));
  assert.equal(parseBackup(localStorage.getItem(STORAGE_KEY))[sourceKey(r)].status,'draft');
  dom.window.close(); delete globalThis.document; delete globalThis.localStorage;
});
test('corrupt browser data is preserved and another tab cannot silently overwrite saved progress', () => {
  const dom = new JSDOM('<div id="panel"></div>', {url:'https://maps.test'});
  globalThis.document=dom.window.document; globalThis.localStorage=dom.window.localStorage;
  const r=row(), terrain={...r,sha256:'c'.repeat(64)}, data={bounds:r.bounds,spawns:r.default_spawn_points,xs:[0,100],ys:[0,100],grid_size:2,heights_mm:[0,0,0,0]};
  const viewer={canvas:document.createElement('canvas'),updateSpawns(){}};
  const panel=document.getElementById('panel');
  for (const corrupt of [true,false]) {
    panel.replaceChildren(); localStorage.clear();
    if (corrupt) localStorage.setItem(STORAGE_KEY,'broken backup');
    const sweep=setupSpawnSweep(panel,()=>{},()=>[terrain]);
    panel.querySelector('[data-enable]').checked=true; sweep.attach(terrain,data,viewer);
    if (!corrupt) localStorage.setItem(STORAGE_KEY,'another tab saved here');
    const existing=localStorage.getItem(STORAGE_KEY);
    const x=panel.querySelector('[data-x="0"]'); x.value='35'; x.dispatchEvent(new dom.window.Event('change'));
    assert.equal(localStorage.getItem(STORAGE_KEY),existing);
    assert.match(panel.querySelector('[data-status]').textContent,/Not saved/);
    sweep.clear();
  }
  dom.window.close(); delete globalThis.document; delete globalThis.localStorage;
});
