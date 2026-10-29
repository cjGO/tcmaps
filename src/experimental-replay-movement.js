import * as THREE from 'three';
import { displayedHeight } from './terrain-geometry.js';
import { groundHeight } from './editor-spatial.js';
import { eventIndex } from './experimental-replay.js';
import { resolveDisplayMetadata, displayMeta, matchesDisplay, experimentalHistory, experimentalDeaths } from './experimental-replay-presentation.js';

export function createExperimentalMovement(viewer, data, replay, group, picks, { metadata, reference }) {
  metadata = resolveDisplayMetadata(replay, metadata);
  const resources = [], dummy = new THREE.Object3D(), color = new THREE.Color(), labels = new Map(), viewPoint = new THREE.Vector3();
  const teamColor = team => team === 0 ? '#367ce5' : team === 1 ? '#e65d53' : '#d5ae37';
  const z = value => displayedHeight(value, data.min_height_m, viewer.heightScale);
  function mesh(name, geometry, capacity, material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) {
    const result = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
    result.name = name; result.count = 0; result.frustumCulled = false; result.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    resources.push(geometry, material); group.add(result); picks.set(result, []); return result;
  }
  const units = {
    infantry: mesh('experimental-infantry', new THREE.BoxGeometry(3.4, 3.4, 1), replay.tracks.size),
    cavalry: mesh('experimental-cavalry', new THREE.CylinderGeometry(2.7, 2.7, 1, 3).rotateX(-Math.PI / 2), replay.tracks.size),
    artillery: mesh('experimental-artillery-units', new THREE.CylinderGeometry(2, 2, 1, 24).rotateX(-Math.PI / 2), replay.tracks.size),
    unknown: mesh('experimental-unknown', new THREE.RingGeometry(1.5, 2.4, 4), replay.tracks.size),
    horse: mesh('experimental-horses', new THREE.BoxGeometry(2, 4, 1.5), replay.tracks.size),
  };
  const humans = mesh('experimental-players', new THREE.RingGeometry(2.8, 3.4, 16), replay.tracks.size, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  function put(target, p, tint) {
    const index = target.count++; dummy.position.set(p.x, p.y, z(p.z) + 1);
    dummy.rotation.set(0, 0, (p.rz || 0) * Math.PI / 180); dummy.scale.setScalar(1); dummy.updateMatrix(); target.setMatrixAt(index, dummy.matrix);
    if (tint) target.setColorAt(index, color.set(tint)); picks.get(target)[index] = { entity: p.id };
  }
  function nameLabel(p, meta) {
    let label = labels.get(p.id);
    if (label && label.userData.text !== meta.label) {
      label.material.map.dispose(); label.material.dispose(); label.removeFromParent();
      for (const resource of [label.material.map, label.material]) { const i = resources.indexOf(resource); if (i >= 0) resources.splice(i, 1); }
      labels.delete(p.id); label = null;
    }
    if (!label) {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      ctx.font = '600 28px sans-serif'; canvas.width = Math.min(600, Math.ceil(ctx.measureText(meta.label).width) + 24); canvas.height = 44;
      ctx.fillStyle = '#14212ee6'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '600 28px sans-serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(meta.label, canvas.width / 2, 22, canvas.width - 24);
      const texture = new THREE.CanvasTexture(canvas), material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false, fog: false }); resources.push(texture, material);
      label = new THREE.Sprite(material); label.name = `experimental-player-${p.id}`; label.userData.text = meta.label; label.center.set(.5, 0); label.renderOrder = 15;
      label.onBeforeRender = (renderer, scene, camera) => {
        viewPoint.copy(label.position).applyMatrix4(camera.matrixWorldInverse);
        const perPixel = 2 * (camera.isPerspectiveCamera ? Math.max(.1, -viewPoint.z) : 1) / (camera.projectionMatrix.elements[5] * Math.max(1, viewer.canvas.clientHeight));
        label.scale.set(canvas.width / 2 * perPixel, 22 * perPixel, 1); label.updateMatrixWorld();
      };
      labels.set(p.id, label); group.add(label);
    }
    label.position.set(p.x, p.y, z(p.z) + 4); label.visible = true;
  }
  const vertices = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) for (const [x, y] of [[-2.3, -.4], [2.3, -.4], [2.3, .4], [-2.3, -.4], [2.3, .4], [-2.3, .4]]) vertices.push(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), 0);
  const deathGeometry = new THREE.BufferGeometry(); deathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const deaths = mesh('experimental-bot-deaths', deathGeometry, replay.tracks.size, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: .4, depthWrite: false }));
  const deathRows = experimentalDeaths(replay, metadata);
  const trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .35, depthWrite: false }); resources.push(trailMaterial);
  function lines() { const geometry = new THREE.BufferGeometry(), line = new THREE.LineSegments(geometry, trailMaterial); line.frustumCulled = false; group.add(line); resources.push(geometry); return line; }
  const full = lines(), partial = lines();
  function writeLines(geometry, rows, capacity = rows.length) {
    if (!geometry.attributes.position || geometry.attributes.position.count < rows.length * 2) {
      geometry.dispose(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, capacity) * 6), 3)); geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(1, capacity) * 6), 3));
    }
    rows.forEach((row, i) => {
      geometry.attributes.position.array.set([row.from.x, row.from.y, z(row.from.z) + 1.5, row.to.x, row.to.y, z(row.to.z) + 1.5], i * 6);
      color.set(teamColor(row.team)); color.toArray(geometry.attributes.color.array, i * 6); color.toArray(geometry.attributes.color.array, i * 6 + 3);
    });
    geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true; geometry.setDrawRange(0, rows.length * 2);
  }
  const heatGeometry = new THREE.PlaneGeometry(1, 1), heatMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false });
  heatMaterial.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) < 0.001) discard;'); };
  resources.push(heatGeometry, heatMaterial);
  let history, historyKey, scale, heat, historyError = '';
  function prepare(options) {
    const key = JSON.stringify([options.players, options.bots, options.soldier, options.squad, options.unitTypes, options.trailUnitTypes]);
    if (historyKey !== key) {
      history = null; historyError = ''; historyKey = key; scale = undefined;
      if (heat) { heat.removeFromParent(); heat.dispose(); heat = null; }
      try { history = experimentalHistory(replay, data, metadata, options); }
      catch (error) { historyError = error.message; }
      if (history) { heat = new THREE.InstancedMesh(heatGeometry, heatMaterial, Math.max(1, history.cells.length)); heat.count = history.cells.length; heat.frustumCulled = false; group.add(heat); }
    }
    if (!history) return;
    if (scale !== viewer.heightScale) {
      writeLines(full.geometry, history.segments); scale = viewer.heightScale;
      history.cells.forEach((row, i) => {
        const x = data.bounds.x_min_m + (row.ix + .5) * history.cell, y = data.bounds.y_min_m + (row.iy + .5) * history.cell;
        dummy.position.set(x, y, z(reference ? 0 : groundHeight(data, x, y)) + .5); dummy.rotation.set(0, 0, 0); dummy.scale.set(history.cell, history.cell, 1); dummy.updateMatrix(); heat.setMatrixAt(i, dummy.matrix);
      }); heat.instanceMatrix.needsUpdate = true;
    }
  }
  function update(frame, state) {
    const { t, seq, layers } = state; let soldiers = 0, horses = 0, names = 0;
    for (const label of labels.values()) label.visible = false;
    for (const p of frame.entities) {
      const meta = displayMeta(replay.tracks.get(p.id), p, metadata);
      if (!matchesDisplay(meta, state)) continue;
      const horse = p.kind === 'horse'; if (horse) horses++; else soldiers++;
      if (Number(state.follow) === p.id) continue;
      put(units[horse ? 'horse' : meta.unit_category], p, teamColor(p.team));
      if (p.kind === 'player') { put(humans, p); if (state.playerNames) { nameLabel(p, meta); names++; } }
    }
    deaths.material.opacity = state.deathOpacity ?? .4;
    if (state.botDeaths !== false) for (let i = 0, end = eventIndex(deathRows, t, seq); i <= end; i++) {
      const row = deathRows[i]; if (matchesDisplay(row, state) && (!state.deathUnitTypes || state.deathUnitTypes.includes(row.unit_category))) put(deaths, row, teamColor(row.team));
    }
    full.visible = partial.visible = false; if (heat) heat.visible = false;
    let trailSegments = 0;
    if (layers.trails || state.heatmap) {
      prepare(state);
      if (history) {
        if (layers.trails) {
          full.visible = partial.visible = true; trailMaterial.opacity = state.trailOpacity ?? .35;
          const count = history.completed(t, seq), rows = history.partial(t); full.geometry.setDrawRange(0, count * 2); writeLines(partial.geometry, rows, replay.tracks.size); trailSegments = count + rows.length;
        }
        if (state.heatmap) {
          heat.visible = true; const values = history.heatAt(t), max = values.reduce((a, b) => Math.max(a, b), 1);
          values.forEach((v, i) => { color.set(v > 0 ? '#ff0000' : '#000000'); if (v > 0) color.setHSL((1 - v / max) * .16, 1, .5); heat.setColorAt(i, color); }); if (heat.instanceColor) heat.instanceColor.needsUpdate = true;
        }
      }
    }
    return { soldiers, horses, names, botDeaths: deaths.count, trailSegments, historyError, unitCounts: Object.fromEntries(Object.entries(units).map(([key, value]) => [key, value.count])) };
  }
  return { update, heatmap(state) { prepare(state); if (historyError) throw new Error(historyError); const values = history?.heatAt(state.t); return history ? history.cells.map((row, i) => ({ x_m: data.bounds.x_min_m + (row.ix + .5) * history.cell, y_m: data.bounds.y_min_m + (row.iy + .5) * history.cell, soldier_seconds: values[i] })) : []; },
    dispose() { heat?.dispose(); for (const label of labels.values()) label.removeFromParent(); for (const resource of resources) resource.dispose(); /* Instanced meshes are disposed by the parent layer. */ } };
}
