import * as THREE from 'three';
import { displayedHeight } from './terrain-geometry.js';
import { groundHeight } from './editor-spatial.js';
import { soldierAt } from './tactical-replay.js';

export function createReplayLayer(viewer, data, replay) {
  const group = new THREE.Group(), capacity = replay.tracks.size, dummy = new THREE.Object3D();
  const geometry = new THREE.ConeGeometry(1.7, 4.5, 3); // local +Y points forward
  const material = new THREE.MeshBasicMaterial({ color: 'white' });
  const soldiers = new THREE.InstancedMesh(geometry, material, capacity);
  const ringsGeometry = new THREE.RingGeometry(2.5, 3.3, 12), ringsMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  const humans = new THREE.InstancedMesh(ringsGeometry, ringsMaterial, capacity);
  for (const mesh of [soldiers, humans]) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(mesh); }
  const heatGeometry = new THREE.PlaneGeometry(1, 1), heatMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false });
  let heat, heatRows = [], cellSize = 10, state = { t: replay.first, players: true, bots: true, heatmap: false };
  const colors = [new THREE.Color('#247bff'), new THREE.Color('#fa493e')], neutral = new THREE.Color('#f8d24e');
  viewer.addLayer(group);
  function update(next = {}) {
    Object.assign(state, next); let count = 0, people = 0;
    for (const track of replay.tracks.values()) {
      const p = soldierAt(track, state.t, replay);
      if (!p || (p.kind === 'player' ? !state.players : !state.bots)) continue;
      dummy.position.set(p.x, p.y, displayedHeight(p.z, data.min_height_m, viewer.heightScale) + 2);
      dummy.rotation.set(0, 0, -p.facing * Math.PI / 180); dummy.scale.set(p.mounted ? 1.4 : 1, p.mounted ? 2.4 : 1, 1); dummy.updateMatrix();
      soldiers.setMatrixAt(count, dummy.matrix); soldiers.setColorAt(count++, colors[p.team] || neutral);
      if (p.kind === 'player') { dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.position.z += 1; dummy.updateMatrix(); humans.setMatrixAt(people++, dummy.matrix); }
    }
    soldiers.count = count; humans.count = people;
    soldiers.instanceMatrix.needsUpdate = humans.instanceMatrix.needsUpdate = true;
    if (soldiers.instanceColor) soldiers.instanceColor.needsUpdate = true;
    if (heat) {
      heat.visible = state.heatmap;
      heatRows.forEach((row, i) => {
        const x = data.bounds.x_min_m + (row.ix + .5) * cellSize, y = data.bounds.y_min_m + (row.iy + .5) * cellSize;
        dummy.position.set(x, y, displayedHeight(groundHeight(data, x, y), data.min_height_m, viewer.heightScale) + 1);
        dummy.rotation.set(0, 0, 0); dummy.scale.set(cellSize, cellSize, 1); dummy.updateMatrix(); heat.setMatrixAt(i, dummy.matrix);
      }); heat.instanceMatrix.needsUpdate = true;
    }
    viewer.draw(false); return count;
  }
  function setHeatmap(result) {
    if (heat) { group.remove(heat); heat.dispose(); }
    const merged = new Map();
    for (const row of result.cells) { const key = `${row.ix},${row.iy}`; const p = merged.get(key) || { ...row, seconds: 0 }; p.seconds += row.seconds; merged.set(key, p); }
    heatRows = [...merged.values()]; cellSize = result.cell_metres;
    heat = new THREE.InstancedMesh(heatGeometry, heatMaterial, heatRows.length); heat.frustumCulled = false; group.add(heat);
    const maximum = Math.max(1, ...heatRows.map(r => r.seconds));
    heatRows.forEach((row, i) => heat.setColorAt(i, new THREE.Color().setHSL(.16 * (1 - Math.sqrt(row.seconds / maximum)), 1, .5)));
    update();
  }
  const unsubscribe = viewer.onHeightChange(() => update());
  return { update, setHeatmap, dispose() { unsubscribe(); group.removeFromParent(); soldiers.dispose(); humans.dispose(); heat?.dispose(); for (const r of [geometry, material, ringsGeometry, ringsMaterial, heatGeometry, heatMaterial]) r.dispose(); } };
}
