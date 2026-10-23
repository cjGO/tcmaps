import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root=new URL('../',import.meta.url), read=path=>readFile(new URL(path,root),'utf8');
const [template,coordinates,app,mapsText]=await Promise.all(['map_editor/web/index.html','map_editor/web/coordinates.js','map_editor/web/app.js','lib/editor-maps.json'].map(read));
const project=JSON.parse(await read('public/'+JSON.parse(mapsText).find(m=>m.id==='scn_mp_custom_map_1').project));
function editor() {
  const dom=new JSDOM(template.replace('__EDITOR_DATA__',JSON.stringify(project)),{runScripts:'outside-only',url:'https://map-editor.test/'});
  const w=dom.window;
  w.ResizeObserver=class {observe(){} disconnect(){}};
  w.SVGElement.prototype.setPointerCapture=()=>{};
  w.eval(coordinates); w.eval(app);
  const $=id=>w.document.getElementById(id), change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('change'));};
  return {dom,w,$,change,api:w.MapEditor};
}
test('favorites filter, persist, sync across maps and leave loadouts and undo untouched',()=>{
  const {dom,w,api,$}=editor();
  try {
    const name=$('asset').value, before=JSON.stringify(api.getState().document);
    $('asset-favorite').click();
    assert.deepEqual(JSON.parse(w.localStorage.getItem('map-editor.asset-favorites.v1')),[name]);
    assert.equal($('asset-favorite').getAttribute('aria-pressed'),'true');
    $('assets-favorites').click();
    assert.equal($('asset').options.length,1);
    assert.equal($('asset').value,name);
    assert.equal(JSON.stringify(api.getState().document),before);
    assert.equal($('undo').disabled,true);
    api.placeAt(200,300);
    $('asset-favorite').click();
    assert.equal($('asset').options.length,0);
    assert.equal($('asset-favorite').disabled,true);
    assert.throws(()=>api.placeAt(210,310),/Choose an asset/);
    // Selecting a placed object remains possible after it is removed from favorites.
    api.select(api.getState().document.placements[0].id);
    assert.equal($('assets-all').getAttribute('aria-pressed'),'true');
    assert.equal($('asset').value,name);
    w.localStorage.setItem('map-editor.asset-favorites.v1',JSON.stringify([name,'other-map-asset']));
    w.dispatchEvent(new w.StorageEvent('storage',{key:'map-editor.asset-favorites.v1'}));
    $('assets-favorites').click();
    assert.equal($('asset').options.length,1);
    $('asset-favorite').click();
    assert.deepEqual(JSON.parse(w.localStorage.getItem('map-editor.asset-favorites.v1')),['other-map-asset']);
    w.localStorage.setItem('map-editor.asset-favorites.v1','broken');
    w.dispatchEvent(new w.StorageEvent('storage',{key:'map-editor.asset-favorites.v1'}));
    assert.equal($('asset').options.length,0);
  } finally {dom.window.close();}
});
test('line batches accept a favorite mix independently of the brush and undo atomically',()=>{
  const {dom,api,$}=editor();
  try {
    const [a,b]=project.assets;
    api.placeBatch([{asset:a.name,x_m:200,y_m:300},{asset:b.name,x_m:210,y_m:310}]);
    assert.deepEqual(Array.from(api.getState().document.placements,p=>p.asset),[a.name,b.name]);
    const before=JSON.stringify(api.getState().document);
    assert.throws(()=>api.placeBatch([{asset:a.name,x_m:200,y_m:300},{asset:'unknown',x_m:210,y_m:310}]));
    assert.equal(JSON.stringify(api.getState().document),before);
    $('undo').click();
    assert.equal(api.getState().document.placements.length,0);
    $('redo').click();
    assert.deepEqual(Array.from(api.getState().document.placements,p=>p.asset),[a.name,b.name]);
  } finally {dom.window.close();}
});
test('3D placements and 2D controls share selections, scale/yaw, and one undo entry per drag',()=>{
  const {dom,api,$,change}=editor();
  try {
    const id=api.placeAt(200.1234,300.2346);
    assert.equal($('count').textContent,'1 object');
    assert.equal($('overlay').querySelectorAll('[data-id]').length,1);
    assert.equal(api.getState().document.placements[0].x_m,200.123);
    change('yaw','90'); change('scale','2');
    api.beginMove(id); api.moveTo(210,310); api.moveTo(230,330); api.finishMove();
    let p=api.getState().document.placements[0];
    assert.equal(p.x_m,230); assert.equal(p.yaw_deg,90); assert.equal(p.scale,2);
    $('undo').click(); p=api.getState().document.placements[0]; assert.equal(p.x_m,200.123); assert.equal(p.scale,2);
    $('redo').click(); assert.equal(api.getState().document.placements[0].x_m,230);
    api.beginMove(id); api.moveTo(400,400); api.finishMove(true);
    assert.equal(api.getState().document.placements[0].x_m,230);
    $('undo').click(); assert.equal(api.getState().document.placements[0].x_m,200.123);
  } finally {dom.window.close();}
});
test('invalid 3D placements/moves leave saved data intact, and snapshots cannot mutate the editor',()=>{
  const {dom,api,$}=editor();
  try {
    assert.throws(()=>api.placeAt(-1,50)); assert.equal(api.getState().document.placements.length,0);
    const id=api.placeAt(200,300), before=JSON.stringify(api.getState().document);
    api.beginMove(id); assert.throws(()=>api.moveTo(10000,NaN)); api.finishMove();
    assert.equal(JSON.stringify(api.getState().document),before);
    const copy=api.getState(); copy.document.placements[0].scale=10;
    assert.equal(api.getState().document.placements[0].scale,1);
    $('undo').click(); assert.equal(api.getState().document.placements.length,0);
  } finally {dom.window.close();}
});
test('3D export/import uses existing version-3 loadouts and preserves biome, spawns and undo',async()=>{
  const {dom,w,api,$,change}=editor();
  try {
    api.placeAt(201,302); change('biome','snow'); change('spawn-x','150');
    let saved;
    w.URL.createObjectURL=blob=>{saved=blob;return 'blob:test';}; w.URL.revokeObjectURL=()=>{};
    w.HTMLAnchorElement.prototype.click=()=>{};
    $('export').click();
    const text=await new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(saved);});
    const loadout=JSON.parse(text);
    assert.equal(loadout.version,3); assert.equal(loadout.settings.biome,'snow'); assert.equal(loadout.spawn_points[0].x_m,150);
    assert.deepEqual(Object.keys(loadout.placements[0]).sort(),['asset','id','scale','x_m','y_m','yaw_deg']);
    assert.deepEqual(loadout.source,project.source);
    api.select(loadout.placements[0].id); $('delete').click();
    Object.defineProperty($('file'),'files',{value:[{size:text.length,text:async()=>text}],configurable:true});
    $('file').dispatchEvent(new w.Event('change')); await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(JSON.stringify(api.getState().document),JSON.stringify(loadout));
    $('undo').click(); assert.equal(api.getState().document.placements.length,0);
  } finally {dom.window.close();}
});
test('2D terrain clicks and palette changes notify the 3D bridge without another saved state',()=>{
  const {dom,w,api,$,change}=editor();
  try {
    let latest, calls=0; const unsubscribe=api.subscribe(value=>{latest=value;calls++;});
    $('overlay').getBoundingClientRect=()=>({left:0,top:0,width:1000,height:1000});
    const point=w.MapCoordinates.worldToImage(250,350,project.calibration);
    $('overlay').dispatchEvent(new w.MouseEvent('pointerdown',{button:0,clientX:point.u*1000,clientY:point.v*1000}));
    assert.equal(latest.document.placements[0].x_m,250); assert.equal(latest.document.placements[0].y_m,350);
    api.setMode('navigate'); change('scale','1.5');
    assert.equal(latest.mode,'navigate'); assert.equal(latest.brush.scale,1.5);
    const count=calls; unsubscribe(); api.select(null); assert.equal(calls,count);
  } finally {dom.window.close();}
});

test('scenery categories filter by mesh/name and mixed assets survive JSON export/import',async()=>{
  const {dom,w,api,$,change}=editor();
  try {
    const tree=api.placeAt(200,300);
    api.setMode('place'); change('asset-category','Furniture & containers');
    assert.ok([...$('asset').options].every(o=>project.assets.find(a=>a.name===o.value).group==='Furniture & containers'));
    $('search').value='barrel'; $('search').dispatchEvent(new w.Event('input'));
    assert.ok($('asset').options.length>0);
    assert.ok([...$('asset').options].every(o=>{const a=project.assets.find(a=>a.name===o.value);return `${a.name} ${a.mesh} ${a.label}`.includes('barrel');}));
    change('asset','spr_barrel'); change('yaw','75'); change('scale','1.5');
    const barrel=api.placeAt(220.123,310.456);
    const expected=JSON.stringify(api.getState().document);
    assert.equal(api.getState().document.placements[1].asset,'spr_barrel');
    api.select(tree);
    assert.equal($('asset-category').value,''); assert.equal($('search').value,'');
    assert.equal($('asset').options.length,project.assets.length);
    api.select(barrel);
    let blob; w.URL.createObjectURL=value=>{blob=value;return 'blob:test';}; w.URL.revokeObjectURL=()=>{};
    w.HTMLAnchorElement.prototype.click=()=>{}; $('export').click();
    const saved=await new Promise(resolve=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.readAsText(blob);});
    assert.equal(JSON.stringify(JSON.parse(saved)),expected);
    $('delete').click(); assert.equal(api.getState().document.placements.length,1);
    Object.defineProperty($('file'),'files',{value:[{size:saved.length,text:async()=>saved}],configurable:true});
    $('file').dispatchEvent(new w.Event('change')); await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(JSON.stringify(api.getState().document),expected);
    $('undo').click(); assert.equal(api.getState().document.placements.length,1);
  } finally {dom.window.close();}
});

test('editing hotkeys update props and placement settings with wrap, limits, and undo',()=>{
  const {dom,w,api,$,change}=editor();
  const key=(value,options={})=>w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options}));
  try {
    key('d'); assert.equal(api.getState().brush.yaw_deg,359);
    key('a'); assert.equal(api.getState().brush.yaw_deg,0);
    key('q'); assert.equal(api.getState().brush.scale,1.1);
    const id=api.placeAt(200,300);
    key('A'); key('e');
    let point=api.getState().document.placements[0];
    assert.equal(point.yaw_deg,1); assert.equal(point.scale,1);
    key('z',{ctrlKey:true}); assert.equal(api.getState().document.placements[0].scale,1.1);
    api.select(id); change('scale','10'); key('q'); assert.equal(api.getState().document.placements[0].scale,10);
    change('scale','0.1'); key('e'); assert.equal(api.getState().document.placements[0].scale,.1);
    key('x',{ctrlKey:true}); assert.equal(api.getState().document.placements.length,1);
    $('search').dispatchEvent(new w.KeyboardEvent('keydown',{key:'x',bubbles:true}));
    assert.equal(api.getState().document.placements.length,1);
    key('x'); assert.equal(api.getState().document.placements.length,0);
    key('z',{ctrlKey:true}); assert.equal(api.getState().document.placements.length,1);
  } finally {dom.window.close();}
});

test('controls help opens from the sidebar and suppresses editing shortcuts',()=>{
  const {dom,w,api,$}=editor();
  try {
    $('hotkeys').showModal=()=>{$('hotkeys').open=true;};
    $('hotkeys-open').click(); assert.equal($('hotkeys').open,true);
    assert.match($('hotkeys').textContent,/Move \(pan\) the camera/);
    assert.match($('hotkeys').textContent,/Rotate the camera angle/);
    api.placeAt(200,300);
    for(const key of ['x','a','q']) w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true}));
    const point=api.getState().document.placements[0];
    assert.equal(point.yaw_deg,0); assert.equal(point.scale,1);
  } finally {dom.window.close();}
});

test('Space toggles Navigate and Place once per press without editing while typing or dragging',()=>{
  const {dom,w,api,$}=editor();
  const space=(target=w.document.body,options={})=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true,...options}));
  try {
    space(); assert.equal(api.getState().mode,'navigate');
    space(w.document.body,{repeat:true}); assert.equal(api.getState().mode,'navigate');
    space(); assert.equal(api.getState().mode,'place');
    space($('search')); assert.equal(api.getState().mode,'place');
    space(w.document.body,{ctrlKey:true}); assert.equal(api.getState().mode,'place');
    const id=api.placeAt(200,300); api.beginMove(id);
    space(); assert.equal(api.getState().mode,'place'); api.finishMove();
    $('hotkeys').open=true; space(); assert.equal(api.getState().mode,'place');
    $('hotkeys').open=false;
    api.setMode('select'); space(); assert.equal(api.getState().mode,'navigate');
    space(); assert.equal(api.getState().mode,'place');
    assert.equal(api.getState().document.placements.length,1);
  } finally {dom.window.close();}
});

test('line batches validate atomically and undo/redo as a group',()=>{
  const {dom,api,$}=editor();
  try {
    api.setMode('line');
    api.placeBatch([{x_m:200,y_m:200},{x_m:220,y_m:210},{x_m:240,y_m:220}]);
    assert.equal(api.getState().document.placements.length,3);
    assert.throws(()=>api.placeBatch([{x_m:210,y_m:210},{x_m:-10,y_m:210}]));
    assert.equal(api.getState().document.placements.length,3);
    $('undo').click(); assert.equal(api.getState().document.placements.length,0);
    $('redo').click(); assert.equal(api.getState().document.placements.length,3);
  } finally {dom.window.close();}
});

test('line placements preserve individual preview yaws through undo/redo',()=>{
  const {dom,api,$,change}=editor();
  try {
    change('yaw','45');
    api.placeBatch([{x_m:200,y_m:200,yaw_deg:12.5},{x_m:220,y_m:210,yaw_deg:270},{x_m:240,y_m:220}]);
    const yaws=()=>Array.from(api.getState().document.placements,p=>p.yaw_deg);
    assert.deepEqual(yaws(),[12.5,270,45]);
    assert.throws(()=>api.placeBatch([{x_m:200,y_m:200,yaw_deg:360}]));
    assert.deepEqual(yaws(),[12.5,270,45]);
    $('undo').click(); assert.equal(api.getState().document.placements.length,0);
    $('redo').click(); assert.deepEqual(yaws(),[12.5,270,45]);
  } finally {dom.window.close();}
});

test('line batches preserve individual scales and reject invalid scales atomically',()=>{
  const {dom,api,$,change}=editor();
  try {
    change('scale','2');
    api.placeBatch([{x_m:200,y_m:200,scale:.8},{x_m:220,y_m:210,scale:1.2},{x_m:240,y_m:220}]);
    const scales=()=>Array.from(api.getState().document.placements,p=>p.scale);
    assert.deepEqual(scales(),[.8,1.2,2]);
    for(const scale of [0,10.1,NaN]) assert.throws(()=>api.placeBatch([{x_m:200,y_m:200,scale}]));
    assert.deepEqual(scales(),[.8,1.2,2]);
    $('undo').click(); assert.equal(api.getState().document.placements.length,0);
    $('redo').click(); assert.deepEqual(scales(),[.8,1.2,2]);
  } finally {dom.window.close();}
});
