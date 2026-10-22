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
