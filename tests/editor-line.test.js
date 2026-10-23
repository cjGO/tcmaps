import test from 'node:test';
import assert from 'node:assert/strict';
import { linePlacements, pathPlacements, lineScales, lineAssetMix, lineAssetScales, shuffleLineAssets } from '../src/editor-line.js';

test('randomizing asset order produces new samples with exactly the same ratio counts', () => {
  const mix = lineAssetMix([{asset:'pine',ratio:2},{asset:'rock',ratio:1},{asset:'barrel',ratio:1}],20);
  let sample = mix;
  for (const random of [()=>.1,()=>.7,()=>.999999]) {
    const next = shuffleLineAssets(sample,random);
    assert.notDeepEqual(next,sample);
    assert.deepEqual([...next].sort(),[...mix].sort());
    sample = next;
  }
  assert.deepEqual(shuffleLineAssets(['pine','pine']),['pine','pine']);
  assert.deepEqual(shuffleLineAssets([]),[]);
  assert.deepEqual(shuffleLineAssets(['pine']),['pine']);
  assert.deepEqual(mix,lineAssetMix([{asset:'pine',ratio:2},{asset:'rock',ratio:1},{asset:'barrel',ratio:1}],20));
});

test('connected paths distribute the total by distance, without duplicate corners', () => {
  const nodes=[{x:0,y:0},{x:30,y:0},{x:30,y:10}];
  assert.deepEqual(pathPlacements(nodes,5,0,[0,0,0,0,0]),[
    {x_m:0,y_m:0},{x_m:10,y_m:0},{x_m:20,y_m:0},{x_m:30,y_m:0},{x_m:30,y_m:10},
  ]);
  assert.deepEqual(pathPlacements(nodes,1,0,[0]),[{x_m:20,y_m:0}]);
  assert.deepEqual(pathPlacements(nodes,5,2,[1,1,1,1,1]),[
    {x_m:0,y_m:2},{x_m:10,y_m:2},{x_m:20,y_m:2},{x_m:30,y_m:2},{x_m:28,y_m:10},
  ]);
  const reverse=pathPlacements([...nodes].reverse(),5,0,[0,0,0,0,0]);
  assert.deepEqual(reverse,[{x_m:30,y_m:10},{x_m:30,y_m:0},{x_m:20,y_m:0},{x_m:10,y_m:0},{x_m:0,y_m:0}]);
});

test('paths support multiple angles and reject missing or degenerate segments', () => {
  const nodes=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  assert.deepEqual(pathPlacements(nodes,4,0,[0,0,0,0]),nodes.map(p=>({x_m:p.x,y_m:p.y})));
  for (const invalid of [[],[{x:0,y:0}],[{x:0,y:0},{x:0,y:0}],[{x:0,y:0},{x:NaN,y:1}]])
    assert.throws(()=>pathPlacements(invalid,5,0,[0,0,0,0,0]));
});

test('each asset uses its own random scale range and can reroll independently', () => {
  const mix = ['pine','rock','pine','rock','barrel'];
  const overrides = new Map([
    ['pine',{enabled:true,low:.5,high:1.5,fractions:[0,0,1,0,0]}],
    ['rock',{enabled:true,low:2,high:4,fractions:[0,.25,0,.75,0]}],
    ['barrel',{enabled:false,low:NaN,high:NaN,fractions:[]}],
  ]);
  const fallback = [1,1,1,1,1.2];
  assert.deepEqual(lineAssetScales(mix,overrides,fallback),[.5,2.5,1.5,3.5,1.2]);
  overrides.get('pine').fractions = [.5,.5,.5,.5,.5];
  assert.deepEqual(lineAssetScales(mix,overrides,fallback),[1,2.5,1,3.5,1.2]);
  overrides.get('pine').enabled = false;
  assert.deepEqual(lineAssetScales(mix,overrides,fallback),[1,2.5,1,3.5,1.2]);
  overrides.get('rock').low = 5;
  assert.throws(()=>lineAssetScales(mix,overrides,fallback),/rock: Scale range/);
});

test('asset ratios round to the total and spread the mix along the line', () => {
  const entries = [{asset:'pine',ratio:2},{asset:'rock',ratio:1}];
  const mix = lineAssetMix(entries,12);
  assert.equal(mix.filter(a=>a==='pine').length,8);
  assert.equal(mix.filter(a=>a==='rock').length,4);
  assert.ok(mix.slice(0,3).includes('rock'));
  assert.deepEqual(lineAssetMix([{asset:'pine',ratio:1}],3),['pine','pine','pine']);
  assert.equal(lineAssetMix(entries,5).filter(a=>a==='pine').length,3);
  assert.equal(lineAssetMix(entries,1).length,1);
  for (const ratio of [0,-1,NaN,Infinity]) assert.throws(()=>lineAssetMix([{asset:'pine',ratio}],10));
  assert.throws(()=>lineAssetMix([],10));
  assert.throws(()=>lineAssetMix(entries,0));
});

test('line distribution includes endpoints, and jitter stays perpendicular', () => {
  const start = {x:10,y:20}, end = {x:40,y:60};
  const base = linePlacements(start,end,3,0,[0,0,0]);
  assert.deepEqual(base,[{x_m:10,y_m:20},{x_m:25,y_m:40},{x_m:40,y_m:60}]);
  const points = linePlacements(start,end,3,5,[-1,.5,1]);
  points.forEach((p,i) => {
    const x=p.x_m-base[i].x_m,y=p.y_m-base[i].y_m;
    assert.ok(Math.abs(x*30+y*40)<1e-10);
    assert.ok(Math.hypot(x,y)<=5);
  });
  assert.deepEqual(linePlacements(start,end,1,0,[0]),[{x_m:25,y_m:40}]);
});

test('invalid line configurations are rejected', () => {
  for(const [count,jitter] of [[0,0],[1.5,0],[1001,0],[2,-1],[2,NaN]])
    assert.throws(()=>linePlacements({x:0,y:0},{x:1,y:1},count,jitter,[0,0]));
  assert.throws(()=>linePlacements({x:1,y:1},{x:1,y:1},2,0,[0,0]));
});

test('random scales interpolate within the entered range and validate limits', () => {
  assert.deepEqual(lineScales(.8,1.2,[0,.5,1]),[.8,1,1.2]);
  assert.deepEqual(lineScales(2,2,[0,.5,1]),[2,2,2]);
  for (const [low, high] of [[0,1],[1,11],[2,1],[NaN,1],[1,Infinity]])
    assert.throws(() => lineScales(low,high,[.5]));
});
