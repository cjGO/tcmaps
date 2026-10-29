import * as THREE from 'three';
import { createExperimentalMovement } from './experimental-replay-movement.js';
import { displayedHeight } from './terrain-geometry.js';
import { replayHeight } from './replay-terrain.js';
import { experimentalFrame, experimentalPose, eventIndex, projectileAt, entityAt } from './experimental-replay.js';

export function createExperimentalLayer(viewer, data, replay, { reference = false, select, metadata } = {}) {
  const group = new THREE.Group(), dummy = new THREE.Object3D(), resources = [], picks = new Map();
  const colors = { shots: '#ffcc55', hits: '#ff4277', deaths: '#3f293a', artillery: '#ff892e', contacts: '#18a39c', fragments: '#cc78ff' };
  function pool(name, geometry, capacity, color = '#ffffff') {
    // Opaque low-poly markers allow depth rejection during dense volleys.
    // Hundreds of overlapping alpha spheres are very expensive on software GPUs.
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    resources.push(geometry, material); group.add(mesh); picks.set(mesh, []); return mesh;
  }
  const movement = createExperimentalMovement(viewer, data, replay, group, picks, { metadata, reference });
  const projectiles = pool('experimental-projectiles', new THREE.OctahedronGeometry(.8), 512, '#b064db');
  const effects = Object.fromEntries(Object.keys(colors).map(k => [k, pool(`experimental-${k}`, k === 'deaths' ? new THREE.TorusGeometry(2, .4, 4, 12) : new THREE.OctahedronGeometry(1), 512, colors[k])]));
  const rings = pool('experimental-highlights', new THREE.RingGeometry(2.5, 3.2, 16), 512, '#ff4277');
  const radii = pool('experimental-radii', new THREE.RingGeometry(.97, 1, 48), 512, '#ff892e');
  const lineGeometry = new THREE.BufferGeometry(), linePositions = new Float32Array(8192 * 6), lineColors = new Float32Array(8192 * 6);
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));
  const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .55 });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial); lines.frustumCulled = false; group.add(lines); resources.push(lineGeometry, lineMaterial);
  let referenceGrid;
  if (reference) {
    const b = data.bounds, span = Math.max(b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m);
    const grid = new THREE.GridHelper(span, 20, '#677985', '#a5b2ba'); grid.rotation.x = Math.PI / 2;
    grid.position.set((b.x_min_m + b.x_max_m) / 2, (b.y_min_m + b.y_max_m) / 2, 0); referenceGrid = grid; group.add(grid); resources.push(grid.geometry, grid.material);
  }
  let current, lineCount = 0, state = { t: replay.first, seq: Infinity, layers: {}, density: 128 };
  const z = value => displayedHeight(value, data.min_height_m, viewer.heightScale);
  const color = new THREE.Color();
  function put(mesh, p, size, ref, tint, height = z(p.z) + .1) {
    const i = mesh.count++; dummy.position.set(p.x, p.y, height);
    dummy.rotation.set(0, 0, (p.rz || 0) * Math.PI / 180); dummy.scale.setScalar(size); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    if (tint) mesh.setColorAt(i, color.set(tint)); picks.get(mesh)[i] = ref;
  }
  function line(a, b, tint) {
    if (lineCount >= 8192) return;
    const offset = lineCount++ * 6; linePositions.set([a.x, a.y, z(a.z) + .2, b.x, b.y, z(b.z) + .2], offset);
    color.set(tint); lineColors.set([color.r, color.g, color.b, color.r, color.g, color.b], offset);
  }
  function update(next = {}) {
    state = { ...state, ...next }; const { t, seq, layers } = state;
    const density = [64, 128, 512].includes(state.density) ? state.density : 128;
    current = experimentalFrame(replay, t, seq, layers, density); lineCount = 0;
    if (referenceGrid) referenceGrid.position.z = z(0);
    for (const mesh of [projectiles, rings, radii, ...Object.values(effects)]) { mesh.count = 0; picks.get(mesh).length = 0; }
    const movementStats = movement.update(current, state);
    for (const p of current.projectiles) {
      put(projectiles, p, 1, { projectile: p.id });
      if (layers.trails) { const rows = replay.projectiles.get(p.id).segments, s = rows[eventIndex(rows, t, seq)]; if (s) line(s.from, p, '#9255ba'); }
    }
    for (const { event, family, age } of current.effects) {
      if (!event.position) continue; const p = experimentalPose(event.position);
      put(effects[family], p, family === 'deaths' ? 1 : 1.5 + age * (family === 'artillery' ? 4 : 2), { event: event.seq }, family === 'shots' ? (age > .25 ? '#c9ced0' : '#ffcc55') : undefined);
      if (family === 'hits' && event.victim) {
        const victim = entityAt(replay.tracks.get(event.victim), t, seq);
        if (victim) put(rings, victim, 1, { entity: victim.id }, undefined, replayHeight(data, victim, viewer.heightScale, !reference && state.terrainPlacement !== false) + 3);
      }
      if (event.type === 'explosion' && layers.radii && event.radius_cm > 0) put(radii, p, event.radius_cm / 100, { event: event.seq });
      if (layers.orientation && ['shot', 'artillery_fire', 'fragment_launch'].includes(event.type)) {
        const angle = p.rz * Math.PI / 180;
        line(p, { ...p, x: p.x - Math.sin(angle) * 6, y: p.y + Math.cos(angle) * 6 }, colors[family]);
      }
    }
    for (const mesh of [projectiles, rings, radii, ...Object.values(effects)]) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    lineGeometry.setDrawRange(0, lineCount * 2); lineGeometry.attributes.position.needsUpdate = true; lineGeometry.attributes.color.needsUpdate = true;
    viewer.draw(false);
    return { ...movementStats, projectiles: current.projectiles.length, effects: current.effects.length };
  }
  function focus(ref) {
    let p;
    if (ref.entity) { const track = replay.tracks.get(ref.entity); p = entityAt(track, state.t, state.seq) || track?.samples[eventIndex(track.samples, state.t, state.seq)]; }
    if (ref.projectile) p = projectileAt(replay.projectiles.get(ref.projectile), state.t, state.seq);
    if (ref.event) { const r = replay.records[ref.event - 1]; if (r?.position) p = experimentalPose(r.position); }
    if (!p) return false;
    const height = ref.entity ? replayHeight(data, p, viewer.heightScale, !reference && state.terrainPlacement !== false) : z(p.z);
    const center = new THREE.Vector3(p.x, p.y, height); viewer.focus(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(35, 35, 20))); return true;
  }
  let down;
  function pointerDown(e) { down = [e.clientX, e.clientY]; }
  function pointerUp(e) {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const hit = viewer.pick(e.clientX, e.clientY, [...picks.keys()])[0];
    if (hit) select?.(picks.get(hit.object)[hit.instanceId]);
  }
  viewer.canvas.addEventListener('pointerdown', pointerDown); viewer.canvas.addEventListener('pointerup', pointerUp);
  viewer.addLayer(group); const unsubscribe = viewer.onHeightChange(() => update());
  return { update, focus, heatmap: () => movement.heatmap(state), dispose() { movement.dispose(); unsubscribe(); viewer.canvas.removeEventListener('pointerdown', pointerDown); viewer.canvas.removeEventListener('pointerup', pointerUp); group.removeFromParent(); for (const r of resources) r.dispose(); for (const mesh of picks.keys()) mesh.dispose(); } };
}
