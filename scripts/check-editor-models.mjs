import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { decodeMesh } from '../src/editor-spatial.js';

const root=new URL('../',import.meta.url), json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const index=await json('lib/editor-models.json'), maps=await json('lib/editor-maps.json'), topology=await json('lib/rotation-topology.json');
assert.equal(index.schema_version,1);
assert.match(index.manifest_url,/^\/editor-models\/[a-f0-9]{20}\/manifest\.json$/);
const manifestURL=new URL('public'+index.manifest_url,root), bytes=await readFile(manifestURL);
assert.equal(sha(bytes),index.manifest_sha256);
const manifest=JSON.parse(bytes);
assert.equal(manifest.units,'metres'); assert.equal(manifest.up_axis,'Z'); assert.equal(manifest.vertex_stride,12);
assert.equal(Object.keys(manifest.assets).length,index.asset_count); assert.equal(Object.keys(manifest.meshes).length,index.mesh_count);
assert.equal(Object.keys(manifest.textures).length,index.texture_count);
assert.deepEqual(index.maps.map(m=>m.id),maps.map(m=>m.id),'Native model library must enable every fixed rotation editor');
assert.deepEqual(topology.maps.map(m=>m.id),maps.map(m=>m.id),'Every editor requires matching height data');
for(const map of index.maps) {
  const registered=maps.find(m=>m.id===map.id), terrain=topology.maps.find(m=>m.id===map.id);
  assert.ok(registered&&terrain,'3D editor requires a registered terrain');
  const project=await json('public/'+registered.project);
  assert.deepEqual(project.source,map.source);
  for(const key of ['sco_sha256','recipe_sha256','terrain_code']) assert.equal(terrain.source[key],project.source[key]);
  assert.equal(project.assets.length,index.asset_count);
  for(const asset of project.assets) assert.deepEqual(manifest.assets[asset.name],{mesh:asset.mesh,ground_offset_m:asset.ground_offset_m});
}
for(const model of Object.values(manifest.meshes)) {
  const bytes=await readFile(new URL(model.file,manifestURL)); assert.equal(sha(bytes),model.sha256);
  const parts=decodeMesh(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),model);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const part of parts) {
    assert.ok(manifest.materials[part.material]);
    for(let i=0;i<part.vertices.length;i+=12) for(let j=0;j<3;j++) {min[j]=Math.min(min[j],part.vertices[i+j]);max[j]=Math.max(max[j],part.vertices[i+j]);}
  }
  // Signed zero is the same native coordinate; numpy/Math.min may retain different signs.
  const zeros=values=>values.map(value=>value===0?0:value);
  assert.deepEqual({min:zeros(min),max:zeros(max)},{min:zeros(model.bounds_m.min),max:zeros(model.bounds_m.max)});
}
for(const material of Object.values(manifest.materials)) {assert.ok(manifest.textures[material.texture]);assert.ok(material.alpha_test>=0&&material.alpha_test<1);assert.ok(Number.isInteger(material.blend_mode)&&material.blend_mode>=0&&material.blend_mode<=7);assert.equal(typeof material.depth_write,'boolean');assert.equal(typeof material.depth_test,'boolean');assert.ok(Number.isInteger(material.render_order));}
for(const texture of Object.values(manifest.textures)) {
  const bytes=await readFile(new URL(texture.file,manifestURL));assert.equal(sha(bytes),texture.sha256);assert.equal(bytes.length,texture.bytes);
}
console.log(`Verified ${index.asset_count} native-scale assets (${index.mesh_count} meshes, ${index.texture_count} textures) for ${index.maps.length} map(s).`);
