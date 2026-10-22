import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { terrainGeometry } from '../src/terrain-geometry.js';
import { groundHeight, placementTransform, decodeMesh } from '../src/editor-spatial.js';

const data = {grid_size:2,xs:[10,20],ys:[30,40],heights_mm:[1000,3000,5000,12000],vertical_scale:1,height_order:'x-major, y-minor'};
test('placement heights match ray intersections on both terrain triangles', () => {
  const arrays = terrainGeometry(data), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(arrays.positions,3));
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices,1));
  const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  for (const [x,y] of [[12,32],[18,38],[15,35],[10,30],[20,40],[11,39],[19,31]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,-1));
    assert.ok(Math.abs(groundHeight(data,x,y)-ray.intersectObject(mesh)[0].point.z)<1e-9);
  }
  assert.equal(groundHeight(data,9,29),1); // one-metre unsampled boundary uses nearest edge
  geometry.dispose(); mesh.material.dispose();
});
test('native origins, metre offsets, yaw and uniform scale match scene transforms', () => {
  const t=placementTransform(data,{x_m:15,y_m:35,yaw_deg:90,scale:2},{ground_offset_m:.25});
  const object=new THREE.Object3D(); object.position.fromArray(t.position); object.rotation.z=t.yaw; object.scale.setScalar(t.scale); object.updateMatrixWorld();
  const origin=new THREE.Vector3(0,0,0).applyMatrix4(object.matrixWorld);
  const forward=new THREE.Vector3(0,1,0).applyMatrix4(object.matrixWorld);
  assert.deepEqual(origin.toArray(),[15,35,4.5]);
  assert.ok(forward.distanceTo(new THREE.Vector3(13,35,4.5))<1e-12);
  assert.throws(()=>placementTransform(data,{x_m:15,y_m:35,yaw_deg:0,scale:0},{ground_offset_m:0}));
});
test('binary model decoder preserves native coordinates and rejects broken indices/layout', () => {
  const buffer=new ArrayBuffer(3*48+12), vertices=new Float32Array(buffer,0,36);
  vertices.set([-2,3,-.2,0,0,1,.2,.3,1,1,1,1],0);
  vertices.set([8,3,20,0,0,1,.2,.3,1,1,1,1],12);
  vertices.set([-2,9,20,0,0,1,.2,.3,1,1,1,1],24);
  const indices=new Uint32Array(buffer,144,3); indices.set([0,1,2]);
  const model={bytes:156,parts:[{vertex_count:3,index_count:3,vertex_offset:0,index_offset:144}]};
  assert.equal(decodeMesh(buffer,model)[0].vertices[14],20);
  assert.equal(decodeMesh(buffer,model)[0].vertices[0],-2);
  assert.throws(()=>decodeMesh(buffer.slice(0,152),model));
  indices[2]=3; assert.throws(()=>decodeMesh(buffer,model));
  indices[2]=2; vertices[0]=NaN; assert.throws(()=>decodeMesh(buffer,model));
});
