import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { groundHeight } from '../src/editor-spatial.js';
import { createExplorerState, switchExplorerMode, stepExplorer, turnExplorer, hazeRange } from '../src/terrain-explorer-motion.js';
import { createTerrainExperience } from '../src/terrain-experience.js';

const data = { grid_size:3,xs:[0,50,100],ys:[0,50,100],heights_mm:[0,5000,10000,12500,17500,22500,25000,30000,35000],
  min_height_m:0,max_height_m:35,relief_m:35,spawns:[{team:0,entry:0,x_m:20,y_m:20,z_m:7},{team:1,entry:32,x_m:80,y_m:20,z_m:22}] };
test('infantry and mounted follow the same measured terrain with correct eye clearance',()=>{
  for(const mode of ['infantry','mounted']) {
    let state=createExplorerState(data,mode,{x:30,y:30});
    for(let i=0;i<100;i++) {
      state=stepExplorer(data,state,{forward:1,right:.3,run:true},1/60);
      assert.equal(state.z,groundHeight(data,state.x,state.y));
      assert.equal(state.eyeHeight,mode==='infantry'?1.7:2.8);
    }
  }
});
test('movement normalizes diagonals, differentiates profiles and caps elapsed-time spikes',()=>{
  const start=createExplorerState(data,'infantry',{x:20,y:20});
  const forward=stepExplorer(data,start,{forward:1},.05),diagonal=stepExplorer(data,start,{forward:1,right:1},.05);
  assert.ok(Math.abs(Math.hypot(forward.x-20,forward.y-20)-Math.hypot(diagonal.x-20,diagonal.y-20))<1e-10);
  const horse=stepExplorer(data,switchExplorerMode(start,'mounted'),{forward:1,run:true},.05);
  assert.ok(horse.y>forward.y);
  assert.deepEqual(stepExplorer(data,start,{forward:1},30),forward);
});
test('exploration stays within measured geometry, retains facing when mounting, and lands hops',()=>{
  let state=createExplorerState(data,'infantry',{x:1000,y:-1000},1.2);
  assert.equal(state.x,99.7);assert.equal(state.y,.3);
  const mounted=switchExplorerMode(state,'mounted');
  for(const key of ['x','y','z','yaw','pitch']) assert.equal(mounted[key],state[key]);
  state=createExplorerState(data,'infantry',{x:50,y:50});
  state=stepExplorer(data,state,{jump:true},.05);assert.ok(state.z>state.ground);
  for(let i=0;i<40;i++) state=stepExplorer(data,state,{},.05);
  assert.equal(state.z,state.ground);assert.equal(state.airborne,false);
  assert.ok(turnExplorer(state,0,100).pitch<Math.PI/2);
});
test('overview haze follows camera distance and overhead remains clear',()=>{
  const ground=hazeRange({exploring:true,span:672}),near=hazeRange({distance:600,span:672}),far=hazeRange({distance:1600,span:672});
  assert.equal(ground.near,100);assert.ok(ground.far>1000);
  assert.equal(far.near-near.near,1000);
  assert.ok(hazeRange({overhead:true,span:672,distance:1000}).near>10000);
  assert.ok(hazeRange({enabled:false,exploring:true,span:672}).near>10000);
});

function setup() {
  const dom=new JSDOM('<div id="view"><canvas tabindex="0"></canvas></div>',{pretendToBeVisual:true,url:'https://editor.test'}),w=dom.window,doc=w.document;
  const view=doc.getElementById('view'),canvas=view.querySelector('canvas');
  const context={createImageData:(x,y)=>({data:new Uint8ClampedArray(x*y*4)}),putImageData(){},drawImage(){},beginPath(){},arc(){},fill(){},stroke(){},fillText(){},save(){},restore(){},translate(){},rotate(){},moveTo(){},lineTo(){},closePath(){}};
  w.HTMLCanvasElement.prototype.getContext=()=>context;
  w.HTMLElement.prototype.setPointerCapture=()=>{};
  w.HTMLElement.prototype.getClientRects=()=>[{}];
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:320,height:320});
  Object.defineProperty(view,'clientWidth',{value:800});
  const pending=new Map();let next=0,time=0,begin=0,end=0,frame=null,currentMode='orbit';
  w.requestAnimationFrame=fn=>{pending.set(++next,fn);return next;};w.cancelAnimationFrame=id=>pending.delete(id);
  const spawns=structuredClone(data.spawns);
  const api={canvas,spawns:()=>spawns,pick:()=>[{point:{x:40,y:60,z:16}}],graphics(){},begin(){begin++;},end(){end++;},frame(s){frame={...s};},modeChanged(mode){currentMode=mode;}};
  const experience=createTerrainExperience(view,data,api);
  const $=name=>view.querySelector(`[data-ui="${name}"]`);
  const key=(type,code)=>canvas.dispatchEvent(new w.KeyboardEvent(type,{code,bubbles:true,cancelable:true}));
  const pointer=(type,x=100,y=100)=>{const event=new w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:1});canvas.dispatchEvent(event);};
  return {dom,w,doc,view,canvas,$,experience,key,pointer,pending,spawns,
    get frame(){return frame;},get begin(){return begin;},get end(){return end;},get mode(){return currentMode;},
    tick(){const callbacks=[...pending.values()];pending.clear();time+=16;callbacks.forEach(fn=>fn(time));},
    close(){experience.dispose();dom.window.close();}};
}
test('explorer input moves without placing/editing, changes profile in place, then exits cleanly',()=>{
  const e=setup();let edits=0;
  try {
    e.canvas.addEventListener('pointerdown',()=>edits++);e.doc.addEventListener('keydown',()=>edits++);
    e.$('infantry').click();assert.equal(e.begin,1);assert.equal(e.mode,'explore');
    const original={...e.frame};e.key('keydown','KeyW');for(let i=0;i<10;i++)e.tick();e.key('keyup','KeyW');e.tick();
    assert.ok(e.frame.x>original.x);assert.equal(edits,0);
    const moved={...e.frame};e.$('mounted').click();assert.equal(e.begin,1);assert.equal(e.frame.x,moved.x);assert.equal(e.frame.y,moved.y);assert.equal(e.frame.yaw,moved.yaw);assert.equal(e.frame.eyeHeight,2.8);
    e.pointer('pointerdown');e.pointer('pointermove',150,100);e.pointer('pointerup',150,100);assert.notEqual(e.frame.yaw,moved.yaw);assert.equal(edits,0);
    e.key('keydown','Delete');assert.equal(edits,0);
    e.$('exit').click();assert.equal(e.end,1);assert.equal(e.mode,'orbit');assert.equal(e.pending.size,0);
    assert.equal(e.$('hud').hidden,true);assert.equal(e.$('minimap-wrap').hidden,true);
  } finally {e.close();}
});
test('stand-here picking consumes editor gestures; team jumps use updated spawns without changing them',()=>{
  const e=setup();let placements=0;
  try {
    e.canvas.addEventListener('pointerdown',()=>placements++);
    e.$('pick').click();assert.equal(e.mode,'pick');
    e.pointer('pointerdown');e.pointer('pointerup');assert.equal(e.mode,'explore');assert.equal(e.frame.x,40);assert.equal(e.frame.y,60);assert.equal(placements,0);
    e.spawns[1].x_m=72;e.spawns[1].y_m=37;
    const savedSpawns=structuredClone(e.spawns);
    e.$('team2').click();assert.equal(e.frame.x,72);assert.equal(e.frame.y,37);
    assert.deepEqual(e.spawns,savedSpawns);assert.equal(data.spawns[1].x_m,80);
    e.key('keydown','KeyW');e.tick();const last=e.frame.x;
    e.w.dispatchEvent(new e.w.Event('blur'));assert.equal(e.pending.size,0);e.tick();assert.equal(e.frame.x,last);
    e.experience.exit();assert.equal(e.mode,'orbit');
  } finally {e.close();}
});
test('pointer-lock rejection leaves drag-look and movement available',async()=>{
  const e=setup();
  try {
    e.canvas.requestPointerLock=async()=>{throw new Error('Denied');};
    e.$('infantry').click();e.$('lock').click();await Promise.resolve();await Promise.resolve();
    assert.match(e.$('message').textContent,/Drag to look/);
    const before=e.frame.yaw;e.pointer('pointerdown');e.pointer('pointermove',130,100);e.pointer('pointerup',130,100);
    assert.notEqual(e.frame.yaw,before);assert.equal(e.mode,'explore');
    e.key('keydown','Escape');assert.equal(e.mode,'orbit');
  } finally {e.close();}
});
