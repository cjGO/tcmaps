import test from 'node:test';
import assert from 'node:assert/strict';
import { createScatterField, scatterRegion, insideScatterRegion, generateScatter, decorateScatter, scatterPresets } from '../src/editor-scatter.js';

const bounds={x_min_m:0,x_max_m:200,y_min_m:0,y_max_m:200};
const base={bounds,settings:{coverage:100,density:4,spacing:2},fieldSeed:42,positionSeed:17};
const xy=points=>points.map(({x_m,y_m})=>[x_m,y_m]);
test('scatter repeats exactly and position rerolls preserve the density field',()=>{
  const a=generateScatter(base), b=generateScatter(base), c=generateScatter({...base,positionSeed:18});
  assert.deepEqual(a.points,b.points);assert.equal(a.points.length,a.requested);assert.ok(a.points.length>0);
  assert.notDeepEqual(a.points,c.points);assert.equal(a.field(23,48),c.field(23,48));
  for(const p of a.points) {
    assert.ok(insideScatterRegion(p.x_m,p.y_m,a.region));
    assert.ok(Math.abs(p.x_m*1000-Math.round(p.x_m*1000))<1e-6);
  }
});
test('concave regions clip the world-anchored field and reject invalid boundaries',()=>{
  const polygon=[{x:10,y:10},{x:180,y:10},{x:180,y:70},{x:70,y:70},{x:70,y:180},{x:10,y:180}];
  const a=createScatterField(bounds,null,{},11), b=createScatterField(bounds,polygon,{},11);
  assert.equal(a.field(30,40),b.field(30,40));assert.equal(b.field(120,120),0);
  const result=generateScatter({...base,polygon});
  assert.ok(result.points.length>0);assert.ok(result.points.every(p=>insideScatterRegion(p.x_m,p.y_m,polygon)));
  for(const invalid of [[],[{x:0,y:0},{x:1,y:1}], [{x:0,y:0},{x:80,y:80},{x:0,y:80},{x:80,y:0}],
    [{x:0,y:0},{x:80,y:0},{x:20,y:0},{x:80,y:80}], [{x:-1,y:0},{x:50,y:0},{x:50,y:50}],
    [{x:0,y:0},{x:0,y:0},{x:50,y:50}]]) assert.throws(()=>scatterRegion(bounds,invalid));
});
test('spacing is enforced after quantization against both new and existing objects',()=>{
  const existing=[{x_m:100,y_m:100}], spacing=15;
  const result=generateScatter({...base,settings:{...base.settings,spacing},existing});
  for(let i=0;i<result.points.length;i++) for(const q of [...existing,...result.points.slice(0,i)]) {
    const p=result.points[i];assert.ok(Math.hypot(p.x_m-q.x_m,p.y_m-q.y_m)>=spacing);
  }
  const noAvoid=generateScatter({...base,existing,settings:{...base.settings,avoidExisting:false}});
  assert.deepEqual(noAvoid.points,generateScatter(base).points);
  const blocked=generateScatter({...base,existing,settings:{...base.settings,spacing:1000}});
  assert.equal(blocked.points.length,0);assert.equal(blocked.limited,true);
});
test('coverage, feathering, seeds and presets affect field shape without elevation inputs',()=>{
  const a=createScatterField(bounds,null,{coverage:100,feather:20});
  const unfeathered=createScatterField(bounds,null,{coverage:100});
  assert.equal(a.field(0,100),0);assert.equal(a.field(10,100),unfeathered.field(10,100)*.5);
  assert.equal(a.field(30,100),unfeathered.field(30,100));
  const samples=field=>Array.from({length:100},(_,i)=>field((i%10)*20+5,Math.floor(i/10)*20+5));
  const fields=Object.values(scatterPresets).map(s=>samples(createScatterField(bounds,null,s,42).field));
  for(let i=1;i<fields.length;i++) assert.notDeepEqual(fields[0],fields[i]);
  assert.notDeepEqual(fields[0],samples(createScatterField(bounds,null,{},43).field));
  const low=createScatterField(bounds,null,{coverage:30},42),high=createScatterField(bounds,null,{coverage:60},42);
  assert.ok(samples(low.field).every((v,i)=>v<=samples(high.field)[i]));
});
test('patch interiors retain density gradients and concentrate placements in their denser portions',()=>{
  // Full coverage with hard edges removes boundary thinning entirely. Density
  // must still vary, and placements must follow it rather than fill uniformly.
  const r=generateScatter({...base,bounds:{x_min_m:0,x_max_m:600,y_min_m:0,y_max_m:600},
    settings:{coverage:100,softness:0,density:20,spacing:2}});
  const values=[];
  for(let x=3;x<600;x+=6) for(let y=3;y<600;y+=6) values.push(r.field(x,y));
  values.sort((a,b)=>a-b);
  assert.ok(values.every(v=>v>=0&&v<=1));
  const low=values[2500],high=values[7500];
  assert.ok(high>low*3,'equal-area portions of the field have distinctly different densities');
  const sparse=r.points.filter(p=>r.field(p.x_m,p.y_m)<=low).length;
  const dense=r.points.filter(p=>r.field(p.x_m,p.y_m)>=high).length;
  assert.ok(sparse>0,'sparse interiors still receive some assets');
  assert.ok(dense>sparse*3,'dense interiors receive more assets per unit area');
});
test('empty, invalid, tiny and capped scatters terminate with explicit counts',()=>{
  assert.equal(generateScatter({...base,settings:{coverage:0}}).points.length,0);
  assert.equal(generateScatter({...base,settings:{density:0}}).points.length,0);
  for(const settings of [{patchSize:0},{density:NaN},{spacing:-1},{stretch:0},{softness:101},{feather:Infinity},
    {contrast:-1},{contrast:101},{contrast:NaN}]) assert.throws(()=>generateScatter({...base,settings}));
  const capped=generateScatter({...base,settings:{coverage:100,density:100,spacing:0}});
  assert.equal(capped.points.length,1000);assert.equal(capped.capped,true);
  const existing=Array.from({length:9998},()=>({x_m:0,y_m:0}));
  assert.equal(generateScatter({...base,existing}).points.length,2);
  assert.equal(generateScatter({...base,existing:[...existing,...existing.slice(0,2)]}).points.length,0);
  const tiny=generateScatter({...base,bounds:{x_min_m:.0001,x_max_m:.004,y_min_m:.0001,y_max_m:.004}});
  assert.equal(tiny.points.length,0);
});
test('contrast strengthens the same density pattern and its placement concentrations without rerolling',()=>{
  const args={...base,bounds:{x_min_m:0,x_max_m:600,y_min_m:0,y_max_m:600},
    settings:{coverage:100,softness:0,density:20,spacing:2}};
  const standard=generateScatter(args);
  const strong=generateScatter({...args,settings:{...args.settings,contrast:80}});
  const uniform=createScatterField(args.bounds,null,{...args.settings,contrast:0},args.fieldSeed);
  const samples=[];
  for(let x=3;x<600;x+=6) for(let y=3;y<600;y+=6) {
    assert.equal(uniform.field(x,y),1);
    const value=standard.field(x,y),enhanced=strong.field(x,y);
    assert.ok(enhanced>=0&&enhanced<=value);
    samples.push({value,enhanced});
  }
  samples.sort((a,b)=>a.value-b.value);
  // The same locations remain relatively dense or sparse; contrast increases
  // their density ratio rather than choosing new noise or moving the hotspots.
  for(let i=1;i<samples.length;i++) assert.ok(samples[i].enhanced>=samples[i-1].enhanced);
  const low=samples[2500],high=samples[7500];
  assert.ok(high.enhanced/low.enhanced>3*high.value/low.value);
  const coreShare=points=>points.filter(p=>standard.field(p.x_m,p.y_m)>=high.value).length/points.length;
  assert.ok(strong.points.length>0&&strong.points.length<standard.points.length);
  assert.ok(coreShare(strong.points)>coreShare(standard.points)+.2);
  assert.deepEqual(generateScatter({...args,settings:{...args.settings,contrast:50}}).points,standard.points);
  const feathered=createScatterField(bounds,null,{contrast:0,coverage:100,feather:20});
  assert.equal(feathered.field(0,100),0);assert.equal(feathered.field(10,100),.5);
  assert.equal(createScatterField(bounds,null,{contrast:0,coverage:0}).field(100,100),0);
});
test('mix ratios, scales and independent random streams preserve scatter positions',()=>{
  const points=generateScatter(base).points.slice(0,12),entries=[{asset:'pine',ratio:2,scale:{enabled:true,low:2,high:3}},{asset:'rock',ratio:1}];
  const a=decorateScatter(points,entries),b=decorateScatter(points,entries,{assetSeed:99});
  assert.equal(a.filter(p=>p.asset==='pine').length,8);assert.deepEqual(xy(a),xy(b));
  assert.deepEqual(a.map(p=>p.yaw_deg),b.map(p=>p.yaw_deg));
  assert.ok(a.every(p=>p.scale>=(p.asset==='pine'?2:.8)&&p.scale<=(p.asset==='pine'?3:1.2)));
  for(const [key,field] of [['yawSeed','yaw_deg'],['scaleSeed','scale']]) {
    const c=decorateScatter(points,entries,{[key]:100});
    assert.deepEqual(xy(a),xy(c));assert.deepEqual(a.map(p=>p.asset),c.map(p=>p.asset));
    assert.notDeepEqual(a.map(p=>p[field]),c.map(p=>p[field]));
  }
  const fixed=decorateScatter(points,[{asset:'rock',ratio:1}],{randomYaw:false,yaw:90,randomScale:false,scale:2});
  assert.ok(fixed.every(p=>p.yaw_deg===90&&p.scale===2));
  assert.throws(()=>decorateScatter(points,[]));assert.throws(()=>decorateScatter(points,[{asset:'rock',ratio:0}]));
  assert.throws(()=>decorateScatter([],entries,{low:2,high:1}));
});
