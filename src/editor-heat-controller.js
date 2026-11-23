import * as THREE from 'three';
import { terrainGeometry } from './terrain-geometry.js';
import { createLineAssetPicker } from './editor-line-picker.js';
import { decorateScatter } from './editor-scatter.js';
import { generateHeatLayout, heatLayoutField } from './editor-heat-layout.js';

const variantLabel = id => id === 'source' ? 'Source / RAW' : id === 'unidentified' ? 'Unidentified variant'
  : id.replace(/^var([a-z0-9]+)$/i, (_, key) => 'Var' + key.toUpperCase());

function heatOverlay(data, { size, bounds, values }) {
  const pixels = new Uint8Array(values.length * 4);
  values.forEach((value, i) => {
    pixels.set([255, Math.round(58 + 141 * value), Math.round(41 + 33 * value), Math.round(220 * Math.sqrt(value))], i * 4);
  });
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const { positions, indices } = terrainGeometry(data);
  const uv = new Float32Array(positions.length / 3 * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uv[i * 2] = (positions[i * 3] - bounds.x_min_m) / (bounds.x_max_m - bounds.x_min_m);
    uv[i * 2 + 1] = (positions[i * 3 + 1] - bounds.y_min_m) / (bounds.y_max_m - bounds.y_min_m);
    positions[i * 3 + 2] += .15;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true,
    toneMapped: false, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  mesh.renderOrder = 9;
  return mesh;
}

export function createHeatController({ doc, project, api, extras, context, transform, loadHeat }) {
  const button = doc.createElement('button'), panel = doc.createElement('section');
  button.id = 'editor-heat';
  button.textContent = 'HEAT layouts';
  button.hidden = true;
  button.setAttribute('aria-controls', 'heat-panel');
  panel.id = 'heat-panel';
  panel.className = 'editor-line-panel';
  panel.hidden = true;
  panel.innerHTML = `<h3>HEAT layouts</h3>
    <p>Place scenery around recorded movement and deaths. Hotter areas receive more assets.</p>
    <p id="heat-status" role="status"></p>
    <button id="heat-retry" type="button" hidden>Retry heat data</button>
    <div id="heat-controls" hidden>
      <label>Recordings<select id="heat-variant"><option value="">All variants &amp; RAW</option></select></label>
      <label>Placement signal<select id="heat-metric">
        <option value="both">Player movement + deaths</option><option value="movement">Player movement</option>
        <option value="deaths">All deaths</option><option value="playerDeaths">Player deaths</option><option value="botDeaths">Bot deaths</option>
      </select></label>
      <p id="heat-evidence" class="hint" role="status"></p>
      <div class="pair">
        <label>Assets<input id="heat-count" type="number" min="1" max="1000" value="30"></label>
        <label>Spacing (m)<input id="heat-spacing" type="number" min="0" max="200" step="any" value="8"></label>
      </div>
      <label>Smoothing (m)<input id="heat-smoothing" type="number" min="0" max="30" value="8"></label>
      <label><input id="heat-overlay" type="checkbox" checked> Show placement heatmap</label>
      <label><input id="heat-random-yaw" type="checkbox"> Randomize rotation</label>
      <details><summary>Asset mix</summary><div id="heat-asset-picker"></div></details>
      <div id="heat-mix"></div>
      <button id="heat-preview" type="button">Generate preview</button>
      <button id="heat-shuffle" type="button">Reshuffle preview</button>
      <button id="heat-place" type="button" disabled>Place assets</button>
    </div>`;
  doc.querySelector('.modes').append(button);
  doc.querySelector('aside').prepend(panel);
  const $ = id => panel.querySelector(`#heat-${id}`);
  const layer = new THREE.Group(), assets = new THREE.Group();
  layer.add(assets);
  extras.add(layer);
  layer.visible = false;
  const mix = new Map();
  const labels = new Map(project.assets.map(asset => [asset.name, asset.label]));
  let picker, archive, overlay, field, terrain, renderKey, points = [], previewKey, stateKey;
  let disposed = false, loading = false, token = 0, seed = 1;
  const status = message => { $('status').textContent = message; };
  const keyFor = state => JSON.stringify([state.brush.yaw_deg, state.brush.scale,
    state.document.placements.map(p => [p.x_m, p.y_m]), state.document.spawn_points.map(p => [p.x_m, p.y_m])]);
  const active = () => {
    const { ready, is3D, state } = context();
    return Boolean(loadHeat && ready && is3D && state.mode === 'heat');
  };

  function clearPreview() {
    token++;
    assets.clear();
    points = [];
    $('place').disabled = true;
  }
  function invalidate() {
    clearPreview();
    if (archive) status('Generate a preview to place assets.');
    context().viewer?.draw();
  }
  function clearOverlay() {
    if (!overlay) return;
    layer.remove(overlay);
    overlay.geometry.dispose();
    overlay.material.map.dispose();
    overlay.material.dispose();
    overlay = null;
  }
  function updateField() {
    if (!archive || !active()) return;
    const { data, viewer } = context();
    const smoothing = $('smoothing').valueAsNumber;
    const metric = $('metric').value;
    const key = JSON.stringify([$('variant').value, metric, smoothing]);
    if (terrain === data && renderKey === key && overlay) return;
    terrain = data;
    renderKey = key;
    clearOverlay();
    field = null;
    if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > 30) {
      $('evidence').textContent = 'Smoothing must be between 0 and 30 metres.';
    } else {
      field = heatLayoutField(archive, $('variant').value, metric, smoothing);
      const figures = [];
      if (metric === 'movement' || metric === 'both') figures.push(`${(field.playerSeconds / 60).toFixed(1)} player-minutes`);
      if (metric !== 'movement') figures.push(`${field.deathCount.toLocaleString()} ${field.deathCount === 1 ? 'death' : 'deaths'}`);
      $('evidence').textContent = `${field.rounds} ${field.rounds === 1 ? 'recording' : 'recordings'} · ${figures.join(' · ')}`;
      overlay = heatOverlay(data, field);
      layer.add(overlay);
      overlay.visible = $('overlay').checked;
    }
    const usable = Boolean(field?.values.some(value => value > 0));
    $('preview').disabled = $('shuffle').disabled = !usable;
    if (field && !usable) $('evidence').append(' · No usable positions for this signal.');
    viewer.draw();
  }
  function updateMix() {
    picker.update(api.getState().favorites);
    $('mix').replaceChildren();
    for (const [asset, ratio] of mix) {
      const row = doc.createElement('div'), name = doc.createElement('span'), weight = doc.createElement('input');
      row.className = 'line-asset-row';
      name.textContent = labels.get(asset);
      weight.type = 'number';
      weight.min = '.01';
      weight.step = 'any';
      weight.value = ratio;
      weight.setAttribute('aria-label', `${name.textContent} ratio`);
      weight.addEventListener('input', () => { mix.set(asset, weight.valueAsNumber); invalidate(); });
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${name.textContent}`);
      remove.addEventListener('click', () => { mix.delete(asset); updateMix(); invalidate(); });
      row.append(name, weight, remove);
      $('mix').append(row);
    }
  }
  function initialize() {
    if (picker) return;
    mix.set(api.getState().brush.asset, 1);
    picker = createLineAssetPicker($('asset-picker'), project.assets, { prefix: 'heat', selection: mix, onAdd(asset) {
      mix.set(asset.name, 1);
      updateMix();
      invalidate();
    } });
    updateMix();
  }
  async function loadData() {
    if (loading || archive || !loadHeat) return;
    loading = true;
    $('retry').hidden = true;
    status('Loading movement and death data…');
    try {
      const data = await loadHeat();
      if (disposed) return;
      archive = data;
      for (const group of archive.groups) $('variant').add(new doc.defaultView.Option(variantLabel(group.variant), group.variant));
      $('controls').hidden = false;
      status('Generate a preview to place assets.');
      updateField();
    } catch (error) {
      if (!disposed) {
        status(`Could not load HEAT data. ${error.message}`);
        $('retry').hidden = false;
      }
    } finally { loading = false; }
  }
  async function preview() {
    invalidate();
    const version = token;
    const { library, viewer } = context(), state = api.getState(), key = keyFor(state);
    try {
      if (!active() || !field) return;
      if (!mix.size) throw new Error('Add at least one asset to the mix.');
      const count = $('count').valueAsNumber;
      const positions = generateHeatLayout(field, { count, spacing: $('spacing').valueAsNumber, seed,
        existing: state.document.placements, spawns: state.document.spawn_points });
      if (!positions.length) throw new Error('No assets fit. Reduce spacing or choose another placement signal.');
      const batch = decorateScatter(positions, [...mix].map(([asset, ratio]) => ({ asset, ratio })), {
        assetSeed: seed, yawSeed: seed, randomYaw: $('random-yaw').checked, yaw: state.brush.yaw_deg,
        randomScale: false, scale: state.brush.scale,
      });
      status('Loading asset previews…');
      const models = new Map(await Promise.all([...new Set(batch.map(p => p.asset))].map(async asset => [asset, await library.create(asset)])));
      if (disposed || token !== version || !active() || keyFor(api.getState()) !== key) return;
      for (const point of batch) {
        const object = models.get(point.asset).clone(true);
        transform(object, point);
        assets.add(object);
      }
      points = batch;
      previewKey = key;
      $('place').disabled = false;
      status(`${points.length} of ${count} assets fit. Ready to place.`);
      viewer.draw();
    } catch (error) {
      if (!disposed && token === version) {
        assets.clear();
        status(error.message);
        viewer?.draw();
      }
    }
  }

  function sync() {
    const { ready, is3D, state } = context();
    const visible = active();
    button.hidden = !ready || !is3D || !loadHeat;
    button.setAttribute('aria-pressed', String(visible));
    panel.hidden = !visible;
    if (!visible && layer.visible) clearPreview();
    layer.visible = visible;
    if (!ready) clearOverlay();
    if (!visible) return;
    initialize();
    picker.update(state.favorites);
    const key = keyFor(state);
    if (stateKey && stateKey !== key) invalidate();
    stateKey = key;
    if (archive) updateField();
    else if (!$('retry').hidden) return;
    else loadData();
  }
  button.addEventListener('click', () => {
    if (button.hidden) return;
    context().viewer.exitExplorer();
    api.setMode('heat');
  });
  $('retry').addEventListener('click', loadData);
  for (const id of ['variant', 'metric', 'smoothing']) $(id).addEventListener('input', () => { invalidate(); updateField(); });
  for (const id of ['count', 'spacing', 'random-yaw']) $(id).addEventListener('input', invalidate);
  $('overlay').addEventListener('change', () => {
    if (overlay) overlay.visible = $('overlay').checked;
    context().viewer?.draw();
  });
  $('preview').addEventListener('click', preview);
  $('shuffle').addEventListener('click', () => { seed++; preview(); });
  $('place').addEventListener('click', () => {
    if (!active() || !points.length) return;
    if (keyFor(api.getState()) !== previewKey) { invalidate(); return; }
    try {
      api.placeBatch(points);
      const count = points.length;
      stateKey = keyFor(api.getState());
      clearPreview();
      status(`Placed ${count} assets.`);
      context().viewer.draw();
    } catch (error) { status(error.message); }
  });
  return { sync, dispose() {
    disposed = true;
    clearPreview();
    clearOverlay();
    extras.remove(layer);
    button.remove();
    panel.remove();
  } };
}
