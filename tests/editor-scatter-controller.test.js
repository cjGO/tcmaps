import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createScatterController } from '../src/editor-scatter-controller.js';
import { createLineAssetPicker } from '../src/editor-line-picker.js';
import { createLinePresets } from '../src/editor-line-presets.js';
import { scatterLayoutParameters } from '../src/editor-scatter.js';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [template,coordinates,app,maps]=await Promise.all(['map_editor/web/index.html','map_editor/web/coordinates.js','map_editor/web/app.js','lib/editor-maps.json'].map(read));
const source=JSON.parse(await read('public/'+JSON.parse(maps)[0].project));
const pause=()=>new Promise(resolve=>setTimeout(resolve,190));
function setup(create=async()=>new THREE.Group(),autoGenerate=true) {
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
  controller.button.click();change('coverage',100);if(autoGenerate)$('generate').click();
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
    const preview=s.previews();assert.ok(preview.length>0);
    s.$('place').click();
    const committed=s.api.exportDocument();assert.equal(committed.placements.length,preview.length);
    assert.deepEqual(Array.from(committed.placements,({id,...p})=>({...p})),preview);
    assert.equal(s.$('place').disabled,true);assert.equal(s.previews().length,0);
    s.change('density',5);await pause();assert.equal(s.$('place').disabled,true);
    s.doc.getElementById('undo').click();assert.equal(s.api.getState().document.placements.length,0);
    s.doc.getElementById('redo').click();assert.equal(s.api.getState().document.placements.length,preview.length);
    s.api.loadDocument(committed);assert.equal(s.api.exportDocument().placements.length,preview.length);
    s.$('generate').click();await pause();assert.equal(s.$('place').disabled,false);
  } finally {s.close();}
});
test('randomize noise beside Generate preview starts and rerolls previews without changing settings or documents',async()=>{
  const s=setup(undefined,false);try {
    await pause();assert.equal(s.previews().length,0);
    const before=JSON.stringify(s.api.exportDocument());
    const controls=()=>Array.from(s.controller.panel.querySelectorAll('input,select'),e=>[e.id,e.value,e.checked]);
    const settings=controls();
    const noise=s.$('new-pattern');assert.equal(noise.previousElementSibling,s.$('generate'));
    const pixels=()=>Array.from(s.extras.children[0].children[0].children[0].material.map.image.data);
    noise.click();await pause();const first=s.previews(),heatmap=pixels();assert.ok(first.length>0);
    s.$('generate').click();await pause();assert.deepEqual(s.previews(),first);assert.deepEqual(pixels(),heatmap);
    noise.click();await pause();assert.notDeepEqual(s.previews(),first);assert.notDeepEqual(pixels(),heatmap);
    assert.deepEqual(controls(),settings);assert.equal(JSON.stringify(s.api.exportDocument()),before);
    s.$('place').click();const committed=JSON.stringify(s.api.exportDocument());assert.equal(s.previews().length,0);
    noise.click();await pause();assert.ok(s.previews().length>0);assert.equal(JSON.stringify(s.api.exportDocument()),committed);
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
test('random layouts use ranges, preserve locks and mix, and Previous layout restores the exact preview',async()=>{
  const s=setup(undefined,false);try {
    // Keep the test's layouts populated while sampling patch shape and bearing.
    for(const key of Object.keys(scatterLayoutParameters)) s.change(`range-${key}-enabled`,false);
    s.change('density',12);s.change('patchSize',30);s.change('spacing',3);
    s.change('scale-low',2);s.change('scale-high',3);
    s.change('range-patchSize-enabled',true);s.change('range-patchSize-min',20);s.change('range-patchSize-max',40);
    s.change('range-direction-enabled',true);s.change('range-direction-min',0);s.change('range-direction-max',180);
    const document=JSON.stringify(s.api.exportDocument()),mix=s.$('mix-rows').innerHTML;
    const rangeValues=()=>Array.from(s.$('exploration').querySelectorAll('input'),e=>[e.id,e.value,e.checked]);
    const ranges=rangeValues();
    const pattern=()=>Object.fromEntries(Object.keys(scatterLayoutParameters).map(key=>[key,s.$(key).value]));
    const summary=()=>s.$('generation-summary').textContent;
    assert.equal(s.$('generation-summary').hidden,true);
    s.$('random-layout').click();await pause();
    const first=s.previews(),values=pattern();assert.ok(first.length>0);
    assert.equal(s.$('generation-summary').hidden,false);
    const firstSummary=summary();
    const displayed=Array.from(s.$('generation-summary').querySelectorAll('dt'),term=>[term.textContent,term.nextElementSibling.textContent]);
    for(const [key,p] of Object.entries(scatterLayoutParameters)) {
      assert.deepEqual(displayed.find(([label])=>label===p.label),[p.label,values[key]]);
    }
    assert.ok(Number(values.patchSize)>=20&&Number(values.patchSize)<=40);
    assert.equal(values.spacing,'3');assert.equal(values.coverage,'100');assert.equal(values.density,'12');
    assert.ok(first.every(p=>p.scale>=2&&p.scale<=3));
    assert.equal(s.$('preset').selectedOptions[0].textContent,'Custom layout');
    s.$('random-layout').click();await pause();assert.notDeepEqual(s.previews(),first);
    assert.deepEqual(rangeValues(),ranges);assert.equal(s.$('mix-rows').innerHTML,mix);
    s.$('previous-layout').click();await pause();assert.deepEqual(s.previews(),first);assert.deepEqual(pattern(),values);
    assert.equal(summary(),firstSummary);
    s.$('generate').click();await pause();assert.deepEqual(s.previews(),first);
    assert.equal(JSON.stringify(s.api.exportDocument()),document);
    s.$('place').click();assert.equal(s.previews().length,0);
    assert.equal(s.$('generation-summary').hidden,true);
    const committed=JSON.stringify(s.api.exportDocument());
    s.$('random-layout').click();await pause();assert.ok(s.previews().length>0);
    assert.equal(JSON.stringify(s.api.exportDocument()),committed);
    s.doc.getElementById('undo').click();assert.equal(s.api.getState().document.placements.length,0);
  } finally {s.close();}
});
test('range editing leaves the current preview intact and invalid ranges only block new random layouts',async()=>{
  const s=setup();try {
    await pause();const preview=s.previews();assert.ok(preview.length>0);
    const summary=s.$('generation-summary').textContent;
    assert.equal(s.$('range-spacing-min').disabled,true);
    s.change('range-patchSize-min',500);await pause();
    assert.equal(s.$('random-layout').disabled,true);assert.match(s.$('range-status').textContent,/Patch size/);
    assert.equal(s.$('place').disabled,false);assert.deepEqual(s.previews(),preview);
    assert.equal(s.$('generation-summary').textContent,summary);
    assert.equal(s.$('generation-summary').hidden,false);
    s.change('range-patchSize-min','');assert.equal(s.$('random-layout').disabled,true);
    s.change('range-patchSize-enabled',false);assert.equal(s.$('random-layout').disabled,false);
    assert.equal(s.$('range-patchSize-min').disabled,true);assert.deepEqual(s.previews(),preview);
  } finally {s.close();}
});
test('density contrast previews the same seed, restores previous results and leaves the document untouched',async()=>{
  const s=setup();try {
    s.change('patchSize',20);s.change('density',20);s.change('contrast',0);await pause();
    const original=s.previews(),document=JSON.stringify(s.api.exportDocument());
    const pixels=()=>Array.from(s.extras.children[0].children[0].children[0].material.map.image.data);
    const even=pixels();assert.ok(original.length>0);
    s.change('contrast',80);await pause();
    assert.ok(s.previews().length>0&&s.previews().length<original.length);
    assert.notDeepEqual(pixels(),even);
    assert.equal(s.$('density').value,'20');assert.equal(s.$('coverage').value,'100');
    s.change('contrast',0);await pause();
    assert.deepEqual(s.previews(),original);assert.deepEqual(pixels(),even);
    assert.equal(JSON.stringify(s.api.exportDocument()),document);
    s.change('contrast',101);await pause();assert.equal(s.$('place').disabled,true);
    assert.match(s.$('status').textContent,/contrast/);
    s.change('preset','Broken woodland');assert.equal(s.$('contrast').value,'50');
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
