import {groundHeight} from './editor-spatial.js';
import {terrainGeometry} from './terrain-geometry.js';

const encoder=new TextEncoder();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function joinBytes(parts) {
  const result=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));
  let offset=0;
  for(const part of parts) { result.set(part,offset); offset+=part.length; }
  return result;
}
export function splitScene(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<12 || view.getUint32(0,true)!==0xfffffd33 || view.getUint32(4,true)!==4) throw new Error('Unsupported map file. Download requires a version 4 SCO.');
  const count=view.getUint32(8,true), objects=[];
  let offset=12;
  for(let i=0;i<count;i++) {
    if(offset+84>bytes.length) throw new Error('Truncated map object.');
    const length=view.getUint32(offset+60,true), end=offset+84+length;
    if(end>bytes.length) throw new Error('Truncated map object name.');
    objects.push({kind:view.getUint32(offset,true),id:view.getUint32(offset+4,true),
      entry:view.getUint32(offset+64+length,true),raw:bytes.subarray(offset,end)});
    offset=end;
  }
  return {objects,tail:bytes.subarray(offset)};
}
function record(kind,id,name,position,basis,first=0,scale=1,second=0) {
  if(!/^[\x20-\x7e]*$/.test(name) || ![...position,...basis,scale].every(Number.isFinite)) throw new Error('Invalid native map object.');
  const text=encoder.encode(name), bytes=new Uint8Array(84+text.length), view=new DataView(bytes.buffer);
  view.setUint32(0,kind,true); view.setUint32(4,id,true);
  [...basis,...position].forEach((value,i)=>{
    view.setFloat32(12+i*4,value,true);
    if(!Number.isFinite(view.getFloat32(12+i*4,true))) throw new Error('Object coordinates exceed map format limits.');
  });
  view.setUint32(60,text.length,true); bytes.set(text,64);
  view.setUint32(64+text.length,first,true); view.setUint32(68+text.length,second,true);
  for(let i=0;i<3;i++) view.setFloat32(72+text.length+i*4,scale,true);
  return bytes;
}
const identity=[1,0,0,0,1,0,0,0,1];

export function buildScene({source,recipe,project,terrain,native,document},coordinates) {
  if(!coordinates) throw new Error('Editor validation is unavailable. Reload and retry.');
  const placements=coordinates.validate(document,project);
  const settings=coordinates.validateSettings(document);
  const spawns=coordinates.validateSpawns(document,project);
  if(settings.biome!=='source') throw new Error('Set Biome to Keep source before downloading. Other biomes need new terrain measurements.');
  terrainGeometry(terrain); // Validate the exact same grid used by the editor.
  const scene=project.source.scene_id;
  const lines=recipe.trimEnd().split(/\r?\n/), fields=lines[0]?.trim().split(/\s+/);
  if(!/^scn_[A-Za-z0-9_]+$/.test(scene) || lines.length!==4 || fields.length!==11 || fields[0]!==scene
      || fields[1]!==scene.slice(4) || !['256','1280'].includes(fields[2])
      || fields[10]!==project.source.terrain_code || lines[1].trim()!=='0' || lines[2].trim()!=='0'
      || !/^\S+$/.test(lines[3].trim())) throw new Error('Scene record does not match this map.');
  if(native.version!==1 || native.asset_catalogue_sha256!==project.asset_catalogue_sha256
      || native.flora_catalogue_sha256!==project.flora_catalogue_sha256) throw new Error('Map asset definitions do not match.');
  const assets=new Map(native.assets.map(asset=>[asset.name,asset]));
  if(assets.size!==project.assets.length || project.assets.some(a=>!assets.has(a.name))) throw new Error('Incomplete native assets.');
  const {objects,tail}=splitScene(source), overrides=new Map();
  if(settings.fog!=='source') {
    const distance={none:0,low:600,medium:450,dense:300}[settings.fog] ?? Number(settings.fog);
    overrides.set(506,[Math.floor(distance/10),distance%10]);
  }
  if(settings.precipitation!=='source') {
    const kind=['clear','rain','snow'].indexOf(settings.precipitation);
    overrides.set(504,[kind,kind ? settings.precipitation_intensity : 0]);
  }
  if(settings.thunder!=='source') {
    const kind=['off','thunder','lightning'].indexOf(settings.thunder);
    overrides.set(507,[kind,kind ? settings.thunder_frequency : 0]);
  }
  const moved=!same(spawns,coordinates.editableSpawns(project));
  const kept=objects.filter(o=>!(o.kind===0 && overrides.has(o.id))
    && !(moved && o.kind===1 && [0,32].includes(o.entry))).map(o=>o.raw);
  for(const [id,[first,second]] of overrides) {
    const expected={504:'mm_weather_rain',506:'mm_weather_fog',507:'mm_weather_thunder'}[id];
    if(native.weather[id]!==expected) throw new Error('Weather asset definitions do not match.');
    kept.push(record(0,id,expected,[0,0,0],identity,first,1,second));
  }
  if(moved) {
    spawns.forEach((spawn,i)=>{
      const other=spawns[1-i], dx=other.x_m-spawn.x_m,dy=other.y_m-spawn.y_m, distance=Math.hypot(dx,dy);
      const fx=dx/distance,fy=dy/distance;
      kept.push(record(1,0,'',[spawn.x_m,spawn.y_m,groundHeight(terrain,spawn.x_m,spawn.y_m)],
        [fy,-fx,0,fx,fy,0,0,0,1],spawn.entry));
    });
    fields[2]='256'; lines[0]=fields.join(' ');
  }
  for(const point of placements) {
    const asset=assets.get(point.asset);
    if(![0,4].includes(asset.object_kind) || !Number.isInteger(asset.object_id) || asset.object_id<0
        || !Number.isInteger(asset.variant) || asset.variant<0) throw new Error('Invalid native asset: '+point.asset);
    const angle=point.yaw_deg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const z=groundHeight(terrain,point.x_m,point.y_m)+asset.ground_offset_m*point.scale+(point.z_offset_m??0);
    kept.push(record(asset.object_kind,asset.object_id,asset.object_name,[point.x_m,point.y_m,z],
      [c,s,0,-s,c,0,0,0,1],asset.variant,point.scale));
  }
  const header=source.slice(0,12);
  new DataView(header.buffer).setUint32(8,kept.length,true);
  const sco=joinBytes([header,...kept,tail]);
  splitScene(sco);
  return {sco,recipe:moved ? lines.join('\n')+'\n' : recipe,scene,placementCount:placements.length,spawnsChanged:moved};
}
