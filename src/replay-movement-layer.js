import * as THREE from 'three';
import { displayedHeight } from './terrain-geometry.js';
import { groundHeight } from './editor-spatial.js';
import { replayHeight, terrainTrail } from './replay-terrain.js';

// Stable and experimental replay supply their own timeline/data adapters to
// one renderer, so markers, trails, filters and terrain placement stay in sync.
export function createReplayMovement(viewer, data, model, group, picks, { reference = false, prefix = 'replay' } = {}) {
  const resources = [], dummy = new THREE.Object3D(), color = new THREE.Color(), labels = new Map(), viewPoint = new THREE.Vector3();
  const teamColor = team => team === 0 ? '#247bff' : team === 1 ? '#fa493e' : '#f8d24e';
  const z = value => displayedHeight(value, data.min_height_m, viewer.heightScale);
  let terrain = !reference;
  const placed = p => replayHeight(data, p, viewer.heightScale, terrain);
  function mesh(name, geometry, capacity, material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) {
    const result = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
    result.name = name; result.count = 0; result.frustumCulled = false; result.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    resources.push(geometry, material); group.add(result); picks.set(result, []); return result;
  }
  const units = {
    infantry: mesh(`${prefix}-infantry`, new THREE.BoxGeometry(3.4, 3.4, 1), model.capacity),
    cavalry: mesh(`${prefix}-cavalry`, new THREE.CylinderGeometry(2.7, 2.7, 1, 3).rotateX(-Math.PI / 2), model.capacity),
    artillery: mesh(`${prefix}-artillery-units`, new THREE.CylinderGeometry(2, 2, 1, 24).rotateX(-Math.PI / 2), model.capacity),
    unknown: mesh(`${prefix}-unknown`, new THREE.RingGeometry(1.5, 2.4, 4), model.capacity),
    horse: mesh(`${prefix}-horses`, new THREE.BoxGeometry(2, 4, 1.5), model.capacity),
  };
  const humans = mesh(`${prefix}-players`, new THREE.RingGeometry(2.5, 3.3, 12), model.capacity, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  function put(target, p, tint, offset = 2) {
    const index = target.count++; dummy.position.set(p.x, p.y, placed(p) + offset);
    dummy.rotation.set(0, 0, -(p.facing || 0) * Math.PI / 180); dummy.scale.setScalar(1); dummy.updateMatrix(); target.setMatrixAt(index, dummy.matrix);
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
      label = new THREE.Sprite(material); label.name = `${prefix}-player-${p.id}`; label.userData.text = meta.label; label.center.set(.5, 0); label.renderOrder = 15;
      label.onBeforeRender = (renderer, scene, camera) => {
        viewPoint.copy(label.position).applyMatrix4(camera.matrixWorldInverse);
        const perPixel = 2 * (camera.isPerspectiveCamera ? Math.max(.1, -viewPoint.z) : 1) / (camera.projectionMatrix.elements[5] * Math.max(1, viewer.canvas.clientHeight));
        label.scale.set(canvas.width / 2 * perPixel, 22 * perPixel, 1); label.updateMatrixWorld();
      };
      labels.set(p.id, label); group.add(label);
    }
    label.position.set(p.x, p.y, placed(p) + 6); label.visible = true;
  }
  const vertices = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) for (const [x, y] of [[-2.3, -.4], [2.3, -.4], [2.3, .4], [-2.3, -.4], [2.3, .4], [-2.3, .4]]) vertices.push(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), 0);
  const deathGeometry = new THREE.BufferGeometry(); deathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const deaths = mesh(`${prefix}-bot-deaths`, deathGeometry, model.capacity, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: .4, depthWrite: false }));
  const deathRows = model.deaths;
  let deathKey, filteredDeaths = [];
  function updateDeaths(state) {
    deaths.visible = state.deaths !== false;
    deaths.material.opacity = state.deathOpacity ?? .25;
    if (!deaths.visible) { deaths.count = 0; return; }
    const key = JSON.stringify([state.players, state.bots, state.soldier, state.squad, state.unitTypes, state.deathUnitTypes, viewer.heightScale, terrain]);
    if (key !== deathKey) {
      filteredDeaths = deathRows.filter(row => model.matches(row, state) && (!state.deathUnitTypes || state.deathUnitTypes.includes(row.unit_category)));
      deaths.count = 0; picks.get(deaths).length = 0;
      for (const row of filteredDeaths) put(deaths, row, teamColor(row.team), 2.5);
      deaths.instanceMatrix.needsUpdate = true; deaths.boundingSphere = null;
      if (deaths.instanceColor) deaths.instanceColor.needsUpdate = true;
      deathKey = key;
    }
    deaths.count = model.deathIndex(filteredDeaths, state) + 1;
  }
  const trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .35, depthWrite: false }); resources.push(trailMaterial);
  function lines() { const geometry = new THREE.BufferGeometry(), line = new THREE.LineSegments(geometry, trailMaterial); line.frustumCulled = false; group.add(line); resources.push(geometry); return line; }
  const full = lines(), partial = lines();
  full.name = `${prefix}-trails`; partial.name = `${prefix}-partial-trails`;
  function project(rows) {
    const segments = [], ends = [];
    for (const row of rows) {
      const points = terrainTrail(data, row.from, row.to, terrain);
      for (let i = 0; i + 1 < points.length; i++) segments.push({ from: points[i], to: points[i + 1], team: row.team });
      ends.push(segments.length * 2);
    }
    return { segments, ends };
  }
  function writeLines(geometry, rows) {
    if (!geometry.attributes.position || geometry.attributes.position.count < rows.length * 2) {
      const capacity = Math.max(1, rows.length, (geometry.attributes.position?.count || 0));
      geometry.dispose(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 6), 3)); geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
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
  let history, historyKey, scale, heat, projected, projectedTerrain, historyError = '';
  function prepare(options) {
    const key = JSON.stringify([options.players, options.bots, options.soldier, options.squad, options.unitTypes, options.trailUnitTypes]);
    if (historyKey !== key) {
      history = null; projected = null; historyError = ''; historyKey = key; scale = undefined;
      if (heat) { heat.removeFromParent(); heat.dispose(); heat = null; }
      try { history = model.history(options); }
      catch (error) { historyError = error.message; }
      if (history) { heat = new THREE.InstancedMesh(heatGeometry, heatMaterial, Math.max(1, history.cells.length)); heat.count = history.cells.length; heat.frustumCulled = false; group.add(heat); }
    }
    if (!history) return;
    if (!projected || projectedTerrain !== terrain) {
      projected = project(history.segments); projectedTerrain = terrain; scale = undefined;
    }
    if (scale !== viewer.heightScale) {
      writeLines(full.geometry, projected.segments); scale = viewer.heightScale;
      history.cells.forEach((row, i) => {
        const x = data.bounds.x_min_m + (row.ix + .5) * history.cell, y = data.bounds.y_min_m + (row.iy + .5) * history.cell;
        dummy.position.set(x, y, z(reference ? 0 : groundHeight(data, x, y)) + .5); dummy.rotation.set(0, 0, 0); dummy.scale.set(history.cell, history.cell, 1); dummy.updateMatrix(); heat.setMatrixAt(i, dummy.matrix);
      }); heat.instanceMatrix.needsUpdate = true;
    }
  }
  function update(state) {
    const { t, seq } = state; let soldiers = 0, horses = 0, names = 0, visible = 0;
    terrain = !reference && state.terrainPlacement !== false;
    for (const target of [...Object.values(units), humans]) { target.count = 0; picks.get(target).length = 0; }
    for (const label of labels.values()) label.visible = false;
    for (const p of model.poses(state)) {
      const meta = model.meta(p);
      if (!model.matches(meta, state)) continue;
      const horse = p.kind === 'horse'; if (horse) horses++; else soldiers++;
      if (String(state.followSoldier) === String(p.id)) continue;
      visible++;
      put(units[horse ? 'horse' : meta.unit_category], p, teamColor(p.team));
      if (p.kind === 'player') { put(humans, p, undefined, 3); if (state.playerNames) { nameLabel(p, meta); names++; } }
    }
    updateDeaths(state);
    full.visible = partial.visible = false; if (heat) heat.visible = false;
    let trailSegments = 0;
    if (state.trails || state.heatmap) {
      prepare(state);
      if (history) {
        if (state.trails) {
          full.visible = partial.visible = true; trailMaterial.opacity = state.trailOpacity ?? .25;
          const count = history.completed(t, seq), rows = history.partial(t); full.geometry.setDrawRange(0, projected.ends[count - 1] || 0); writeLines(partial.geometry, project(rows).segments); trailSegments = count + rows.length;
        }
        if (state.heatmap) {
          heat.visible = true; const values = history.heatAt(t), max = values.reduce((a, b) => Math.max(a, b), 1);
          values.forEach((v, i) => { color.set(v > 0 ? '#ff0000' : '#000000'); if (v > 0) color.setHSL((1 - Math.sqrt(v / max)) * .16, 1, .5); heat.setColorAt(i, color); }); if (heat.instanceColor) heat.instanceColor.needsUpdate = true;
        }
      }
    }
    for (const target of [...Object.values(units), humans]) {
      target.instanceMatrix.needsUpdate = true; target.boundingSphere = null;
      if (target.instanceColor) target.instanceColor.needsUpdate = true;
    }
    return { visible, soldiers, horses, names, botDeaths: deaths.visible ? deaths.count : 0, trailSegments, historyError, unitCounts: Object.fromEntries(Object.entries(units).map(([key, value]) => [key, value.count])) };
  }
  return { update, heatmap(state) { terrain = !reference && state.terrainPlacement !== false; prepare(state); if (historyError) throw new Error(historyError); const values = history?.heatAt(state.t); return history ? history.cells.map((row, i) => ({ x_m: data.bounds.x_min_m + (row.ix + .5) * history.cell, y_m: data.bounds.y_min_m + (row.iy + .5) * history.cell, soldier_seconds: values[i] })) : []; },
    dispose() { heat?.dispose(); for (const label of labels.values()) label.removeFromParent(); for (const resource of resources) resource.dispose(); for (const target of [...Object.values(units), humans, deaths]) { target.dispose(); picks.delete(target); } } };
}
