import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createScatterController } from '../src/editor-scatter-controller.js';
import { createLineAssetPicker } from '../src/editor-line-picker.js';
import { createLinePresets } from '../src/editor-line-presets.js';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [template,coordinates,app,maps]=await Promise.all(['map_editor/web/index.html','map_editor/web/coordinates.js','map_editor/web/app.js','lib/editor-maps.json'].map(read));
const source=JSON.parse(await read('public/'+JSON.parse(maps)[0].project));
const pause=()=>new Promise(resolve=>setTimeout(resolve,190));
function setup(create=async()=>new THREE.Group()) {
  const project={...source,default_spawn_points:source.default_spawn_points.map((p,i)=>({...p,x_m:20+i*150,y_m:100})),bounds:{x_min_m:0,x_max_m:200,y_min_m:0,y_max_m:200}};
  const dom=new JSDOM(template.replace('__EDITOR_DATA__',JSON.stringify(project)),{runScripts:'outside-only',url:'https://editor.test/',pretendToBeVisual:true});
  const win=dom.window,doc=win.document;
  win.ResizeObserver=class {observe(){} disconnect(){}};
  win.HTMLCanvasElement.prototype.getContext=()=>({beginPath(){},arc(){},fill(){},fillText(){}});
  win.eval(coordinates);win.eval(app);
  const api=win.MapEditor,extras=new THREE.Group();let is3D=true;
  const controller=createScatterController({doc,project,api,extras,
    context:()=>({ready:true,is3D,state:api.getState(),library:{create},data:{grid_size:2,vertical_scale:1,height_order:'x-major, y-minor',xs:[0,200],ys:[0,200],heights_mm:[0,0,0,0]},viewer:{draw(){},exitExplorer(){},canvas:{clientHeight:600}}}),
    transform(object,p){object.position.set(p.x_m,p.y_m,0);object.userData.preview={...p};},
  });
  const unsubscribe=api.subscribe(()=>controller.sync());
  const $=id=>doc.getElementById('scatter-'+id),change=(id,value)=>{
    const element=$(id);if(element.type==='checkbox')element.checked=value;else element.value=value;
    element.dispatchEvent(new win.Event(element.tagName==='SELECT'||element.type==='checkbox'?'change':'input'));
  };
  controller.button.click();change('coverage',100);$('generate').click();
  return {win,doc,api,controller,extras,$,change,project,
    previews:()=>extras.children[0].children[1].children.map(object=>object.userData.preview),
    switchView(value){is3D=value;controller.sync();},
    close(){unsubscribe();controller.dispose();win.close();},
  };
}
test('scatter previews preserve the document and commit exactly once with undo/redo and export',async()=>{
  const s=setup();try {
    const before=JSON.stringify(s.api.exportDocument());await pause();
    assert.equal(s.api.getState().mode,'scatter');assert.equal(s.$('place').disabled,false);
    assert.equal(JSON.stringify(s.api.exportDocument()),before);
    const preview=s.previews();assert.equal(preview.length,160);
    s.$('place').click();
    const committed=s.api.exportDocument();assert.equal(committed.placements.length,preview.length);
    assert.deepEqual(Array.from(committed.placements,({id,...p})=>({...p})),preview);
    assert.equal(s.$('place').disabled,true);assert.equal(s.previews().length,0);
    s.change('density',5);await pause();assert.equal(s.$('place').disabled,true);
    s.doc.getElementById('undo').click();assert.equal(s.api.getState().document.placements.length,0);
    s.doc.getElementById('redo').click();assert.equal(s.api.getState().document.placements.length,160);
    s.api.loadDocument(committed);assert.equal(s.api.exportDocument().placements.length,160);
    s.$('generate').click();await pause();assert.equal(s.$('place').disabled,false);
  } finally {s.close();}
});
test('scale changes and view toggles retain positions; invalid input disables placement',async()=>{
  const s=setup();try {
    await pause();const positions=()=>s.previews().map(p=>[p.x_m,p.y_m]),before=positions();
    s.change('scale-low',2);s.change('scale-high',3);await pause();
    assert.deepEqual(positions(),before);assert.ok(s.previews().every(p=>p.scale>=2&&p.scale<=3));
    s.change('view','heatmap');assert.equal(s.extras.children[0].children[1].visible,false);
    assert.equal(s.$('place').disabled,false);
    s.change('scale-low',4);await pause();assert.equal(s.$('place').disabled,true);
    assert.match(s.$('status').textContent,/Scale range/);
    s.switchView(false);assert.equal(s.controller.panel.hidden,true);assert.equal(s.extras.children[0].visible,false);
  } finally {s.close();}
});
test('region drawing, invalid crossings, corner dragging and cancellation remain preview-only',async()=>{
  const s=setup();try {
    s.change('area','region');
    for(const p of [{x:10,y:10},{x:150,y:10},{x:150,y:150},{x:10,y:150}]) s.controller.click(p);
    await pause();assert.equal(s.$('place').disabled,true);
    s.$('finish').click();await pause();assert.equal(s.$('place').disabled,false);
    assert.equal(s.controller.markers.length,4);
    const original=s.controller.getNode(1);s.controller.moveNode(1,{x:0,y:100});await pause();
    assert.equal(s.$('place').disabled,true);assert.match(s.$('status').textContent,/cross/);
    s.controller.moveNode(1,original);await pause();assert.equal(s.$('place').disabled,false);
    assert.equal(s.api.getState().document.placements.length,0);
    s.$('remove').click();assert.equal(s.controller.markers.length,3);
    s.$('clear').click();assert.equal(s.controller.markers.length,0);
  } finally {s.close();}
});
test('shared picker and saved mixes have distinct IDs and synchronize within one editor',()=>{
  const s=setup();let linePresets;try {
    const picker=s.doc.createElement('div'),presets=s.doc.createElement('div');s.doc.body.append(picker,presets);
    const selection=new Map();createLineAssetPicker(picker,s.project.assets,{selection,onAdd:a=>selection.set(a.name,1)});
    linePresets=createLinePresets(presets,s.project.assets,{getMix:()=>[{asset:s.project.assets[0].name,ratio:3}],applyMix(){}});
    const ids=Array.from(s.doc.querySelectorAll('[id]'),node=>node.id);assert.equal(new Set(ids).size,ids.length);
    s.doc.getElementById('line-preset-name').value='Shared';s.doc.getElementById('line-preset-save').click();
    assert.match(s.$('preset-select').textContent,/Shared/);
    s.$('preset-select').value=s.$('preset-select').options[1].value;
    s.$('preset-select').dispatchEvent(new s.win.Event('change'));s.$('preset-load').click();
    assert.equal(s.$('mix-rows').querySelector('input[type=number]').value,'3');assert.equal(selection.size,0);
  } finally {linePresets?.dispose();s.close();}
});
test('model failures can retry and stale model loads cannot revive a cancelled preview',async()=>{
  let fail=true;const s=setup(async()=>{if(fail)throw new Error('Model fetch failed');return new THREE.Group();});
  try {
    await pause();assert.equal(s.$('place').disabled,true);assert.match(s.$('status').textContent,/retry/);
    fail=false;s.$('generate').click();await pause();assert.equal(s.$('place').disabled,false);
  } finally {s.close();}
  let release;const pending=new Promise(resolve=>{release=resolve;});const late=setup(()=>pending);
  try {
    await pause();late.switchView(false);release(new THREE.Group());await pause();
    assert.equal(late.$('place').disabled,true);assert.equal(late.previews().length,0);
  } finally {late.close();}
});
