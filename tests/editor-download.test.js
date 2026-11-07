import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildScene,splitScene} from '../src/editor-scene-build.js';
import {createMapDownload} from '../src/editor-download.js';
import {groundHeight} from '../src/editor-spatial.js';
import {resolveNativeAssets} from '../scripts/editor-native-assets.mjs';
const C=createRequire(import.meta.url)('../map_editor/web/coordinates.js');
const maps=JSON.parse(await readFile(new URL('../lib/editor-maps.json',import.meta.url)));
const read=name=>readFile(new URL('../public/'+name,import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(map=maps[0]) {
  const manifest=JSON.parse(await read(map.download.url));
  const files=new Map(await Promise.all(manifest.files.map(async file=>[file.name,await read(file.url)])));
  const parse=name=>JSON.parse(files.get(name));
  const project=parse('project.json');
  return {map,manifest,project,terrain:parse('terrain.json'),native:parse('native-assets.json'),
    source:new Uint8Array(files.get('source.sco')),recipe:files.get('scenes-snippet.txt').toString(),
    document:{version:3,source:project.source,settings:{...C.defaults},placements:[],
      default_spawn_points:project.default_spawn_points,spawn_points:C.editableSpawns(project)}};
}
function view(object) { return new DataView(object.raw.buffer,object.raw.byteOffset,object.raw.byteLength); }

test('all registered sources and installed variants export unchanged without duplicate objects',async()=>{
  assert(maps.some(map=>map.variant_id!=='source'));
  for(const map of maps) {
    const f=await fixture(map), built=buildScene(f,C);
    assert.deepEqual(built.sco,f.source,map.id);
    assert.equal(built.recipe,f.recipe);
    assert.equal(built.spawnsChanged,false);
  }
});

test('native props and flora preserve yaw, scale, variant, sampled height and source bytes',async()=>{
  const f=await fixture(), p=f.document.spawn_points[0];
  const assets=[f.native.assets.find(a=>a.object_kind===0),f.native.assets.find(a=>a.object_kind===4 && a.variant>0)];
  f.document.placements=assets.map((a,i)=>({id:'p'+i,asset:a.name,x_m:p.x_m,y_m:p.y_m,yaw_deg:123,scale:1.7,z_offset_m:-2.25}));
  const built=buildScene(f,C), original=splitScene(f.source), result=splitScene(built.sco);
  assert.deepEqual(result.tail,original.tail);
  assert.deepEqual(result.objects.slice(0,original.objects.length),original.objects);
  for(const [i,asset] of assets.entries()) {
    const object=result.objects[original.objects.length+i], v=view(object), nameLength=v.getUint32(60,true);
    assert.equal(object.kind,asset.object_kind); assert.equal(object.id,asset.object_id);
    assert.equal(object.entry,asset.variant);
    assert(Math.abs(v.getFloat32(56,true)-(groundHeight(f.terrain,p.x_m,p.y_m)+asset.ground_offset_m*1.7-2.25))<0.001);
    assert(Math.abs(v.getFloat32(12,true)-Math.cos(123*Math.PI/180))<1e-6);
    assert(Math.abs(v.getFloat32(72+nameLength,true)-1.7)<1e-6);
  }
  assert.deepEqual(buildScene(f,C).sco,built.sco);
});

test('weather overrides replace their records and moved spawns face each other',async()=>{
  const f=await fixture(), original=splitScene(f.source);
  Object.assign(f.document.settings,{fog:'350',precipitation:'snow',precipitation_intensity:12,thunder:'lightning',thunder_frequency:30});
  f.document.spawn_points[0].x_m+=1;
  const built=buildScene(f,C), result=splitScene(built.sco);
  assert.equal(built.recipe.split(/\s+/)[2],'256');
  assert.deepEqual(result.tail,original.tail);
  for(const [id,first,second] of [[506,35,0],[504,2,12],[507,2,30]]) {
    const rows=result.objects.filter(o=>o.kind===0 && o.id===id);
    assert.equal(rows.length,1); assert.equal(rows[0].entry,first);
    const v=view(rows[0]); assert.equal(v.getUint32(68+v.getUint32(60,true),true),second);
  }
  for(const [i,spawn] of f.document.spawn_points.entries()) {
    const rows=result.objects.filter(o=>o.kind===1 && o.entry===spawn.entry);
    assert.equal(rows.length,1);
    const v=view(rows[0]), other=f.document.spawn_points[1-i];
    assert(Math.abs(v.getFloat32(48,true)-spawn.x_m)<0.001);
    assert(Math.abs(v.getFloat32(56,true)-groundHeight(f.terrain,spawn.x_m,spawn.y_m))<0.001);
    const distance=Math.hypot(other.x_m-spawn.x_m,other.y_m-spawn.y_m);
    assert(Math.abs(v.getFloat32(24,true)-(other.x_m-spawn.x_m)/distance)<1e-6);
  }
  const unaffected=o=>!(o.kind===0 && [504,506,507].includes(o.id)) && !(o.kind===1 && [0,32].includes(o.entry));
  assert.deepEqual(result.objects.filter(unaffected),original.objects.filter(unaffected));
});

test('reject invalid state, changed biome, mismatched native data and truncated SCO',async()=>{
  const original=await fixture();
  for(const mutate of [
    f=>{f.document.settings.biome='snow';},
    f=>{f.document.placements=[{id:'x',asset:'unknown',x_m:1,y_m:1,yaw_deg:0,scale:1}];},
    f=>{f.source=f.source.slice(0,20);},
    f=>{f.native.flora_catalogue_sha256='bad';},
    f=>{f.document.spawn_points[0].x_m=Infinity;},
    f=>{f.terrain.heights_mm[0]=NaN;},
  ]) {
    const f=structuredClone(original); mutate(f);
    assert.throws(()=>buildScene(f,C));
  }
});

test('ZIP captures edits before fetch, survives map changes, and extracts with standard Python zipfile',async()=>{
  const f=await fixture();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const fetcher=async url=>{await gate;return new Response(await read(url));};
  const pending=createMapDownload(f.map,f.document,p=>p,()=>{},{coordinates:C,fetcher});
  f.document.settings.biome='snow'; f.document.source={scene_id:'different-map'};
  release();
  const zip=await pending, folder=await mkdtemp(path.join(tmpdir(),'map-download-'));
  try {
    const file=path.join(folder,'map.zip');
    await writeFile(file,new Uint8Array(await zip.arrayBuffer()));
    const report=JSON.parse(execFileSync('python3',['-c',[
      'import zipfile,json,sys,hashlib',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      ' assert z.testzip() is None',
      ' names=z.namelist()',
      ' print(json.dumps(dict(names=names, document=json.loads(z.read("placements.json")), sha=hashlib.sha256(z.read(next(n for n in names if n.endswith(".sco")))).hexdigest())))',
    ].join('\n'),file],{encoding:'utf8'}));
    assert.deepEqual(report.names.sort(),['README.txt','SceneObj/'+f.project.source.scene_id+'.sco','placements.json','scenes-snippet.txt'].sort());
    assert.equal(report.document.settings.biome,'source');
    assert.equal(report.sha,hash(f.source));
  } finally {await rm(folder,{recursive:true,force:true});}
});

test('missing, corrupt or interrupted fetch fails without changing editing state',async()=>{
  const f=await fixture(), before=structuredClone(f.document);
  for(const fetcher of [
    async()=>new Response('',{status:404}),
    async()=>new Response('corrupt'),
    async()=>{throw new DOMException('Aborted','AbortError');},
  ]) {
    await assert.rejects(createMapDownload(f.map,f.document,p=>p,()=>{},{coordinates:C,fetcher}));
    assert.deepEqual(f.document,before);
  }
});

test('flora resolution uses native kinds and matching collision mesh variants',()=>{
  const flora='1\npine 4194304 2\npine_a bo_a\nlod_a bo_a\npine_b bo_b\nlod_b bo_b\n';
  const assets=[{name:'tree',mesh:'pine_b',collision:true},{name:'prop',kind:'scene_prop',prop_id:10}];
  const resolved=resolveNativeAssets(assets,flora);
  assert.equal(resolved[0].object_kind,4); assert.equal(resolved[0].variant,1);
  assert.equal(resolved[0].object_name,'pine'); assert.equal(resolved[1].object_kind,0);
  assert.throws(()=>resolveNativeAssets([{name:'bad',mesh:'missing',collision:true}],flora));
});
