import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(process.argv[2]||'public/review/highpool');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
const ids=new Set();
if(manifest.count!==manifest.maps.length) throw Error('Review candidate count mismatch');
for(const m of manifest.maps){
 if(ids.has(m.candidate_id))throw Error('Duplicate candidate');ids.add(m.candidate_id);
 for(const [path,hash] of [['sco_file','sco_sha256'],['recipe_file','recipe_sha256'],['heatmap_file','heatmap_sha256']]){
  const bytes=await readFile(resolve(root,m[path]));
  if(createHash('sha256').update(bytes).digest('hex')!==m[hash])throw Error(`Review asset checksum mismatch: ${m[path]}`);
 }
 const g=JSON.parse(await readFile(resolve(root,m.grid_file),'utf8'));
 if(g.heights.length!==g.grid_size**2||g.heights.some(h=>!Number.isFinite(h)))throw Error(`Invalid grid: ${m.name}`);
 if(!(g.bounds.x_min_m<g.bounds.x_max_m&&g.bounds.y_min_m<g.bounds.y_max_m))throw Error(`Invalid bounds: ${m.name}`);
}
console.log(`Verified ${ids.size} review candidates, original heatmaps, SCO/TXT pairs and terrain grids in ${root}.`);
