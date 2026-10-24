import * as THREE from 'three';
import { displayedHeight } from './terrain-geometry.js';
import { groundHeight } from './editor-spatial.js';
import { soldierAt, upperIndex } from './tactical-replay.js';
import { createMovementHistory, matchesHistory, botDeathMarkers } from './replay-history.js';

export function createReplayLayer(viewer, data, replay) {
  const group = new THREE.Group(), capacity = replay.tracks.size, dummy = new THREE.Object3D();
  const geometry = new THREE.ConeGeometry(1.7, 4.5, 3); // local +Y points forward
  const material = new THREE.MeshBasicMaterial({ color: 'white' });
  const soldiers = new THREE.InstancedMesh(geometry, material, capacity);
  const ringsGeometry = new THREE.RingGeometry(2.5, 3.3, 12), ringsMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  const humans = new THREE.InstancedMesh(ringsGeometry, ringsMaterial, capacity);
  for (const mesh of [soldiers, humans]) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(mesh); }
  const heatGeometry = new THREE.PlaneGeometry(1, 1), heatMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false });
  // Untouched cells are black in the instance buffer and contribute no overlay.
  heatMaterial.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) < 0.001) discard;'); };
  let heat, history, filterKey, heightScale, state = { t: replay.first, players: true, bots: true, heatmap: false, trails: false, trailOpacity: .25, deaths: false, deathOpacity: .25, squad: '', soldier: '' };
  const trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .25, depthWrite: false });
  const trailGeometry = new THREE.BufferGeometry(), partialGeometry = new THREE.BufferGeometry();
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial), partial = new THREE.LineSegments(partialGeometry, trailMaterial);
  trails.frustumCulled = partial.frustumCulled = false; group.add(trails, partial);
  const position = p => [p.x, p.y, displayedHeight(p.z, data.min_height_m, viewer.heightScale) + 1.5];
  function writeLines(geometry, segments) {
    const size = segments.length * 6;
    if (!geometry.getAttribute('position') || geometry.getAttribute('position').array.length < size) {
      geometry.dispose();
      const capacity = geometry === partialGeometry ? Math.max(6, replay.tracks.size * 6) : size;
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity), 3));
    }
    const positions = geometry.getAttribute('position'), tint = geometry.getAttribute('color');
    segments.forEach((s, i) => {
      positions.array.set(position(s.from), i * 6); positions.array.set(position(s.to), i * 6 + 3);
      const c = colors[s.team] || neutral;
      c.toArray(tint.array, i * 6); c.toArray(tint.array, i * 6 + 3);
    });
    positions.needsUpdate = tint.needsUpdate = true; geometry.setDrawRange(0, segments.length * 2);
  }
  function prepareHistory() {
    const key = JSON.stringify([state.players, state.bots, state.squad, state.soldier]);
    if (key !== filterKey) {
      history = createMovementHistory(replay, data, state); filterKey = key; heightScale = undefined;
      if (heat) { group.remove(heat); heat.dispose(); }
      heat = new THREE.InstancedMesh(heatGeometry, heatMaterial, history.cells.length); heat.frustumCulled = false; group.add(heat);
    }
    if (heightScale !== viewer.heightScale) {
      writeLines(trailGeometry, history.segments); heightScale = viewer.heightScale;
      history.cells.forEach((row, i) => {
        const x = data.bounds.x_min_m + (row.ix + .5) * history.cell, y = data.bounds.y_min_m + (row.iy + .5) * history.cell;
        dummy.position.set(x, y, displayedHeight(groundHeight(data, x, y), data.min_height_m, viewer.heightScale) + 1);
        dummy.rotation.set(0, 0, 0); dummy.scale.set(history.cell, history.cell, 1); dummy.updateMatrix(); heat.setMatrixAt(i, dummy.matrix);
      }); heat.instanceMatrix.needsUpdate = true;
    }
  }
  const colors = [new THREE.Color('#247bff'), new THREE.Color('#fa493e')], neutral = new THREE.Color('#f8d24e');
  // Two crossed bars form one instanced, team-colored X per confirmed bot death.
  const deathGeometry = new THREE.BufferGeometry(), vertices = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    for (const [x, y] of [[-2.3, -.4], [2.3, -.4], [2.3, .4], [-2.3, -.4], [2.3, .4], [-2.3, .4]]) {
      vertices.push(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), 0);
    }
  }
  deathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const deathMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: .25, depthWrite: false });
  const deathRows = botDeathMarkers(replay);
  const deaths = new THREE.InstancedMesh(deathGeometry, deathMaterial, deathRows.length);
  deaths.name = 'bot-deaths'; deaths.count = 0; deaths.frustumCulled = false; group.add(deaths);
  let filteredDeaths = [], deathFilterKey, deathHeightScale;
  function updateDeaths() {
    deathMaterial.opacity = state.deathOpacity;
    deaths.visible = state.deaths;
    if (!state.deaths) return;
    const key = JSON.stringify([state.bots, state.squad, state.soldier]);
    if (key !== deathFilterKey) {
      filteredDeaths = deathRows.filter(row => matchesHistory(row, row.id, state));
      deathFilterKey = key; deathHeightScale = undefined;
    }
    if (deathHeightScale !== viewer.heightScale) {
      filteredDeaths.forEach((row, i) => {
        dummy.position.set(row.x, row.y, displayedHeight(Math.max(row.z, groundHeight(data, row.x, row.y)), data.min_height_m, viewer.heightScale) + 2.5);
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        deaths.setMatrixAt(i, dummy.matrix); deaths.setColorAt(i, colors[row.team] || neutral);
      });
      deaths.instanceMatrix.needsUpdate = true;
      if (deaths.instanceColor) deaths.instanceColor.needsUpdate = true;
      deathHeightScale = viewer.heightScale;
    }
    deaths.count = upperIndex(filteredDeaths, state.t) + 1;
  }
  viewer.addLayer(group);
  function update(next = {}) {
    Object.assign(state, next); let count = 0, people = 0;
    for (const track of replay.tracks.values()) {
      const p = soldierAt(track, state.t, replay);
      if (!p || String(track.id) === state.followSoldier || !matchesHistory(p, track.id, state)) continue;
      dummy.position.set(p.x, p.y, displayedHeight(p.z, data.min_height_m, viewer.heightScale) + 2);
      dummy.rotation.set(0, 0, -p.facing * Math.PI / 180); dummy.scale.set(p.mounted ? 1.4 : 1, p.mounted ? 2.4 : 1, 1); dummy.updateMatrix();
      soldiers.setMatrixAt(count, dummy.matrix); soldiers.setColorAt(count++, colors[p.team] || neutral);
      if (p.kind === 'player') { dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.position.z += 1; dummy.updateMatrix(); humans.setMatrixAt(people++, dummy.matrix); }
    }
    soldiers.count = count; humans.count = people;
    soldiers.instanceMatrix.needsUpdate = humans.instanceMatrix.needsUpdate = true;
    if (soldiers.instanceColor) soldiers.instanceColor.needsUpdate = true;
    trailMaterial.opacity = state.trailOpacity;
    trails.visible = partial.visible = state.trails;
    if (state.heatmap || state.trails) {
      prepareHistory();
      if (state.trails) {
        trailGeometry.setDrawRange(0, history.completed(state.t) * 2);
        writeLines(partialGeometry, history.partial(state.t));
      }
      if (state.heatmap) {
        const seconds = history.heatAt(state.t), maximum = seconds.reduce((max, value) => Math.max(max, value), 1);
        seconds.forEach((value, i) => heat.setColorAt(i, value > 0 ? new THREE.Color().setHSL(.16 * (1 - Math.sqrt(value / maximum)), 1, .5) : new THREE.Color(0, 0, 0)));
        if (heat.instanceColor) heat.instanceColor.needsUpdate = true;
      }
    }
    if (heat) heat.visible = state.heatmap;
    updateDeaths();
    viewer.draw(false); return count;
  }
  const unsubscribe = viewer.onHeightChange(() => update());
  return { update, dispose() { unsubscribe(); group.removeFromParent(); soldiers.dispose(); humans.dispose(); deaths.dispose(); heat?.dispose(); for (const r of [geometry, material, ringsGeometry, ringsMaterial, heatGeometry, heatMaterial, trailGeometry, partialGeometry, trailMaterial, deathGeometry, deathMaterial]) r.dispose(); } };
}
