import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {resolveNativeAssets} from './editor-native-assets.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const weather={504:'mm_weather_rain',506:'mm_weather_fog',507:'mm_weather_thunder'};

async function moduleRoot(source) {
  let directory=path.dirname(source.sco_path);
  while(directory!==path.dirname(directory)) {
    try { await access(path.join(directory,'scene_props.txt')); return directory; }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    directory=path.dirname(directory);
  }
  throw new Error('Cannot find module definitions for '+source.scene_id);
}

export async function publishDownload(root, map, project, projectDir, projectUrl) {
  const topology=JSON.parse(await readFile(path.join(root,'lib/rotation-topology.json')));
  const terrain=topology.maps.find(row=>row.id===map.id);
  if(!terrain || ['sco_sha256','recipe_sha256','terrain_code'].some(key=>terrain.source[key]!==project.source[key])) {
    throw new Error('Download terrain differs from editor source: '+map.id);
  }
  const module=await moduleRoot(project.source);
  const props=await readFile(path.join(module,'scene_props.txt')), flora=await readFile(path.join(module,'Data/flora_kinds.txt'));
  if(hash(props)!==project.asset_catalogue_sha256 || hash(flora)!==project.flora_catalogue_sha256) throw new Error('Module definitions changed: '+map.id);
  const definitions=props.toString().split(/\r?\n/).filter(line=>line.startsWith('spr_')).map(line=>line.split(/\s+/)[0]);
  for(const [id,name] of Object.entries(weather)) if(definitions[id]!=='spr_'+name) throw new Error('Weather definitions changed');
  const native=json({version:1,asset_catalogue_sha256:project.asset_catalogue_sha256,
    flora_catalogue_sha256:project.flora_catalogue_sha256,weather,assets:resolveNativeAssets(project.assets,flora.toString())});
  const files=new Map([
    ['source.sco',await readFile(path.join(projectDir,'inputs/source.sco'))],
    ['scenes-snippet.txt',await readFile(path.join(projectDir,'inputs/source.txt'))],
  ]);
  if(hash(files.get('source.sco'))!==project.source.sco_sha256 || hash(files.get('scenes-snippet.txt'))!==project.source.recipe_sha256) throw new Error('Download source snapshot changed: '+map.id);
  const directory='editor-downloads/'+map.id+'/'+hash(json([...files].map(([name,bytes])=>[name,hash(bytes)]))).slice(0,20);
  const resources=[];
  async function publish(name,bytes,url) {
    const destination=path.join(root,'public',url);
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,bytes);
    resources.push({name,url,sha256:hash(bytes),bytes:bytes.length});
  }
  for(const [name,bytes] of files) await publish(name,bytes,directory+'/'+name);
  await publish('native-assets.json',native,'editor-downloads/shared/'+hash(native).slice(0,20)+'/native-assets.json');
  for(const [name,url,expected] of [
    ['project.json',projectUrl,hash(await readFile(path.join(projectDir,'project.json')))],
    ['terrain.json',terrain.url.replace(/^\//,''),terrain.sha256],
  ]) {
    const bytes=await readFile(path.join(root,'public',url));
    if(hash(bytes)!==expected) throw new Error('Download resource changed: '+url);
    resources.push({name,url,sha256:expected,bytes:bytes.length});
  }
  const manifest=json({version:2,map_id:map.map_id,variant_id:map.variant_id,variant_revision:map.variant_revision,source:project.source,files:resources});
  const url=directory+'/manifest-'+hash(manifest).slice(0,20)+'.json';
  await writeFile(path.join(root,'public',url),manifest);
  return {url,sha256:hash(manifest)};
}

export async function checkDownload(root,map,project) {
  if(!map.download) throw new Error('Missing map download: '+map.id+'. Run npm run prepare:editor.');
  const bytes=await readFile(path.join(root,'public',map.download.url));
  if(hash(bytes)!==map.download.sha256) throw new Error('Download manifest changed: '+map.id);
  const manifest=JSON.parse(bytes);
  if(manifest.version!==2 || manifest.map_id!==map.map_id || manifest.variant_id!==map.variant_id || manifest.variant_revision!==map.variant_revision || !isDeepStrictEqual(manifest.source,project.source)) throw new Error('Stale download source: '+map.id);
  const resources=new Map();
  for(const resource of manifest.files) {
    const bytes=await readFile(path.join(root,'public',resource.url));
    if(hash(bytes)!==resource.sha256 || bytes.length!==resource.bytes || resources.has(resource.name)) throw new Error('Download resource changed: '+resource.url);
    resources.set(resource.name,bytes);
  }
  if(resources.size!==5 || hash(resources.get('project.json'))!==map.projectSha256
      || hash(resources.get('source.sco'))!==project.source.sco_sha256
      || hash(resources.get('scenes-snippet.txt'))!==project.source.recipe_sha256) throw new Error('Download source mismatch: '+map.id);
  const topology=JSON.parse(await readFile(path.join(root,'lib/rotation-topology.json'))).maps.find(row=>row.id===map.id);
  if(!topology || hash(resources.get('terrain.json'))!==topology.sha256) throw new Error('Stale download terrain: '+map.id);
  const native=JSON.parse(resources.get('native-assets.json'));
  if(native.version!==1 || native.asset_catalogue_sha256!==project.asset_catalogue_sha256 || native.flora_catalogue_sha256!==project.flora_catalogue_sha256
    || native.assets.length!==project.assets.length || !isDeepStrictEqual(native.weather,weather)) throw new Error('Stale native asset definitions');
  for(const [i,asset] of project.assets.entries()) {
    const resolved=native.assets[i];
    if(resolved.name!==asset.name || resolved.mesh!==asset.mesh || resolved.ground_offset_m!==asset.ground_offset_m
      || ![0,4].includes(resolved.object_kind) || !Number.isInteger(resolved.object_id) || !Number.isInteger(resolved.variant)) throw new Error('Invalid native asset mapping');
  }
}
