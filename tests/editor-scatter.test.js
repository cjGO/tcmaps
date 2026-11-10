import test from 'node:test';
import assert from 'node:assert/strict';
import { createScatterField, scatterRegion, insideScatterRegion, generateScatter, decorateScatter, scatterPresets } from '../src/editor-scatter.js';

const bounds={x_min_m:0,x_max_m:200,y_min_m:0,y_max_m:200};
const base={bounds,settings:{coverage:100,density:4,spacing:2},fieldSeed:42,positionSeed:17};
const xy=points=>points.map(({x_m,y_m})=>[x_m,y_m]);
test('scatter repeats exactly and position rerolls preserve the density field',()=>{
  const a=generateScatter(base), b=generateScatter(base), c=generateScatter({...base,positionSeed:18});
  assert.deepEqual(a.points,b.points);assert.equal(a.points.length,160);
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
  assert.equal(a.field(0,100),0);assert.equal(a.field(10,100),.5);assert.equal(a.field(30,100),1);
  const samples=field=>Array.from({length:100},(_,i)=>field((i%10)*20+5,Math.floor(i/10)*20+5));
  const fields=Object.values(scatterPresets).map(s=>samples(createScatterField(bounds,null,s,42).field));
  for(let i=1;i<fields.length;i++) assert.notDeepEqual(fields[0],fields[i]);
  assert.notDeepEqual(fields[0],samples(createScatterField(bounds,null,{},43).field));
  const low=createScatterField(bounds,null,{coverage:30},42),high=createScatterField(bounds,null,{coverage:60},42);
  assert.ok(samples(low.field).every((v,i)=>v<=samples(high.field)[i]));
});
test('empty, invalid, tiny and capped scatters terminate with explicit counts',()=>{
  assert.equal(generateScatter({...base,settings:{coverage:0}}).points.length,0);
  assert.equal(generateScatter({...base,settings:{density:0}}).points.length,0);
  for(const settings of [{patchSize:0},{density:NaN},{spacing:-1},{stretch:0},{softness:101},{feather:Infinity}]) assert.throws(()=>generateScatter({...base,settings}));
  const capped=generateScatter({...base,settings:{coverage:100,density:100,spacing:0}});
  assert.equal(capped.points.length,1000);assert.equal(capped.capped,true);
  const existing=Array.from({length:9998},()=>({x_m:0,y_m:0}));
  assert.equal(generateScatter({...base,existing}).points.length,2);
  assert.equal(generateScatter({...base,existing:[...existing,...existing.slice(0,2)]}).points.length,0);
  const tiny=generateScatter({...base,bounds:{x_min_m:.0001,x_max_m:.004,y_min_m:.0001,y_max_m:.004}});
  assert.equal(tiny.points.length,0);
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
