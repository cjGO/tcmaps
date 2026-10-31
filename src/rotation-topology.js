import identityRegistry from '../lib/editor-rotation.json';
import { publicMapId } from './map-identity.js';
import { setupReplay } from './replay-controls.js';
import { elevationRamp } from './terrain-palettes.js';
import manifest from '../lib/rotation-topology.json';
import './rotation-topology.css';
import { densityDefaults, setupDensityControls } from './rotation-density-controls.js';

export function setupTopology({ prefix = 'rotation', recordings = false } = {}) {
  const maps = new Map(manifest.maps.map(map => [`${map.id}.png`, map]));
  const stage = document.querySelector(`#${prefix}-panel .image-stage`);
  const image = document.getElementById(prefix + '-image'), full = document.getElementById(prefix + '-full-image'), state = document.getElementById(prefix + '-state');
  const panel = document.createElement('div'); panel.className = 'topology-panel'; panel.hidden = true;
  panel.innerHTML = `<div class="topology-heading"><div><span class="topology-badge">3D PREVIEW</span><strong>Map topology</strong></div><div role="group" aria-label="Map display"><button type="button" data-mode="3d" aria-pressed="true">3D topology</button><button type="button" data-mode="heatmap" aria-pressed="false">Heatmap</button></div></div>
    <div class="topology-controls"><label>Overview<select id="topology-camera"><option value="aerial">Aerial</option><option value="reverse">Opposite side</option><option value="overhead">Overhead</option><option value="team1">Team 1 · looking in</option><option value="team2">Team 2 · looking in</option></select></label><label>Height<select id="topology-scale"><option value="1">1× · true scale</option><option value="2">2× · exaggerated</option><option value="4">4× · exaggerated</option></select></label><label class="topology-checkbox"><input id="topology-contours" type="checkbox">2 m contours</label><label class="topology-checkbox"><input id="topology-wireframe" type="checkbox">Mesh</label><button type="button" id="topology-reset">Reset view</button></div>`;
  const live = document.createElement('div'); live.className = 'topology-live'; live.hidden = true;
  const info = document.createElement('div'); info.className = 'topology-info'; info.hidden = true;
  info.innerHTML = '<div class="topology-legend"><span id="topology-low"></span><span class="topology-ramp" aria-hidden="true"></span><span id="topology-high"></span><strong id="topology-scale-note">True height scale</strong></div><p id="topology-metrics"></p><p id="topology-help"></p><p>Measured terrain with preview lighting and haze. Original trees, structures and game weather are omitted; editor additions appear in the Map editor view.</p>';
  if (recordings) {
    for (const element of [...panel.querySelectorAll('[id]'), ...info.querySelectorAll('[id]')]) element.id = 'replays-' + element.id;
  }
  const query = (root, selector) => root.querySelector(recordings ? selector.replace('#topology-', '#replays-topology-') : selector);
  stage.before(panel); stage.append(live); stage.after(info);
  const camera = query(panel, '#topology-camera'), scale = query(panel, '#topology-scale');
  const contour = query(panel, '#topology-contours'), wire = query(panel, '#topology-wireframe');
  let entry, current, viewer, request, generation = 0, selected = '3d', visible = !recordings;
  let densityControls, variantLayer;
  const densitySettings = densityDefaults();
  const modes = [...panel.querySelectorAll('[data-mode]')];
  const replay = recordings ? setupReplay(panel, () => { current = replay.terrain() ? { id: replay.terrain().id } : null; panel.hidden = false; show('3d'); }, stage) : { detach() {}, terrain: () => null, async attach() {} };
  if (recordings) { panel.hidden = false; panel.querySelector('[role=group]').hidden = true; panel.querySelector('.topology-controls').hidden = true; }
  function destroy() { variantLayer?.dispose(); variantLayer = null; densityControls?.dispose(); densityControls = null; replay.detach(); generation++; request?.abort(); viewer?.dispose(); viewer = null; live.replaceChildren(); }
  function scaleNote() { query(info, '#topology-scale-note').textContent = viewer?.mode === 'explore' ? 'Explorer · true scale · preview movement' : scale.value === '1' ? 'True height scale' : `Height exaggerated ${scale.value}×`; }
  function cameraHelp() { query(info, '#topology-help').textContent = viewer?.following ? 'Following the soldier’s recorded position and facing. Camera holds at the last recorded position after death. Escape or Exit soldier view returns to the free camera.' : viewer?.mode === 'explore' ? 'WASD to move · Shift to run/gallop · drag to look or use Mouse look. The minimap shows your position and facing; click it to relocate.' : camera.value.startsWith('team') ? 'Looking inward from 12 m above the original spawn. Infantry / Mounted switches to ground exploration.' : 'Drag to orbit · scroll to zoom · right-drag or arrow keys to pan. Infantry / Mounted explores the terrain; Stand here starts at a point you choose.'; }
  live.addEventListener('terrain-modechange', () => {
    const exploring = viewer?.mode === 'explore';
    camera.disabled = scale.disabled = contour.disabled = wire.disabled = exploring;
    scale.value = String(viewer?.heightScale || 1); scaleNote(); cameraHelp();
  });
  live.addEventListener('terrain-graphics-change', event => {
    info.classList.toggle('natural-surface', event.detail.surface !== 'elevation');
    info.querySelector('.topology-ramp').style.background = elevationRamp(event.detail.palette);
  });
  function applyControls() { viewer.exaggeration(Number(scale.value)); viewer.contours(contour.checked); viewer.wireframe(wire.checked); viewer.preset(camera.value); scaleNote(); cameraHelp(); }
  camera.addEventListener('change', () => { viewer?.preset(camera.value); cameraHelp(); });
  scale.addEventListener('change', () => { viewer?.exaggeration(Number(scale.value)); scaleNote(); });
  contour.addEventListener('change', () => viewer?.contours(contour.checked));
  wire.addEventListener('change', () => viewer?.wireframe(wire.checked));
  query(panel, '#topology-reset').addEventListener('click', () => { viewer?.exitExplorer(); camera.value = 'aerial'; scale.value = '1'; contour.checked = false; wire.checked = false; if (viewer) applyControls(); });
  for (const button of modes) button.addEventListener('click', () => show(button.dataset.mode));
  async function show(mode) {
    selected = mode; destroy();
    const token = generation, is3d = !!current && mode === '3d';
    modes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    panel.querySelector('.topology-controls').hidden = !is3d;
    live.hidden = info.hidden = !is3d; image.hidden = full.hidden = is3d;
    stage.classList.toggle('is-topology', is3d);
    if (!is3d) {
      if (recordings) { image.hidden = full.hidden = true; state.textContent = 'Select an available replay or open a local recording.'; state.hidden = false; return; }
      state.textContent = 'Loading map…'; state.hidden = false;
      if (entry) { image.src = entry.image; image.alt = (publicMapId(identityRegistry, entry.filename) || 'Archived map') + ' elevation heatmap'; full.href = entry.image; }
      if (image.complete && image.naturalWidth) { image.style.opacity = '1'; state.hidden = true; }
      return;
    }
    if (!visible) return;
    state.textContent = 'Loading measured topology…'; state.hidden = false;
    request = new AbortController();
    try {
      const [{ createTopologyViewer }, response] = await Promise.all([import('./topology-viewer.js'), replay.terrain() ? Promise.resolve(null) : fetch(current.url, { signal: request.signal })]);
      if (response && !response.ok) throw new Error('Terrain file could not load');
      const data = replay.terrain() || await response.json();
      if (generation !== token) return;
      viewer = createTopologyViewer(live, data, message => { if (generation === token) { state.textContent = message; state.hidden = false; } });
      info.classList.remove('natural-surface');
      info.querySelector('.topology-ramp').style.background = elevationRamp();
      applyControls();
      if (!recordings && prefix === 'rotation') {
        if (entry?.variant) {
          const { createVariantLayer } = await import('./rotation-variant-layer.js');
          if (generation !== token) return;
          state.textContent = 'Loading variant assets…';
          variantLayer = createVariantLayer(viewer, data, entry.variant.document);
          await variantLayer.ready;
          if (generation !== token) return;
        }
        densityControls = setupDensityControls(live, viewer, data, densitySettings, entry?.variant ? { ...current, variant_id: entry.variant.filename } : current);
      }
      await replay.attach(viewer);
      if (generation !== token) return;
      panel.querySelector('.topology-heading strong').textContent = replay.terrain() ? `Recorded terrain · ${data.id}` : `${publicMapId(identityRegistry, current.id + '.png') || 'Unattributed map'}${entry?.variant ? ' · ' + entry.variant.label : ''} · topology`;
      query(info, '#topology-low').textContent = `${data.min_height_m.toFixed(1)} m`;
      query(info, '#topology-high').textContent = `${data.max_height_m.toFixed(1)} m`;
      const b = data.bounds;
      query(info, '#topology-metrics').textContent = `${b.x_max_m-b.x_min_m} × ${b.y_max_m-b.y_min_m} m · ${data.relief_m.toFixed(1)} m relief · ${data.grid_size} × ${data.grid_size} measured points`;
      info.querySelector('p:last-child').textContent = recordings
        ? 'Measured terrain with preview lighting and haze. Original trees, structures and game weather are omitted.'
        : entry?.variant
        ? `Variant assets loaded: ${entry.variant.label} · ${entry.variant.document.placements.length} placements. Terrain uses preview lighting and haze.`
        : entry?.variantId && !['all', 'source'].includes(entry.variantId)
          ? 'No placement file is included for this variant. Showing source terrain; statistics are filtered to the selected variant.'
          : 'Measured source terrain with preview lighting and haze. Select an included variant to see its placed assets.';
      state.hidden = true;
    } catch (error) {
      if (generation !== token || error.name === 'AbortError') return;
      console.warn('Topology preview unavailable:', error);
      state.textContent = `3D could not load: ${error.message} Select Heatmap to continue, or click 3D topology to retry.`; state.hidden = false;
    }
  }
  function setMap(next) {
    entry = next; current = maps.get(next?.filename); panel.hidden = !current;
    if (!current) { destroy(); live.hidden = info.hidden = true; stage.classList.remove('is-topology'); return; }
    panel.querySelector('.topology-heading strong').textContent = `${publicMapId(identityRegistry, current.id + '.png') || 'Unattributed map'}${entry?.variant ? ' · ' + entry.variant.label : ''} · topology`;
    show(selected);
  }
  function setVisible(value) { visible = value; if (!value) destroy(); else if (current && selected === '3d' && !viewer) show('3d'); }
  return { setMap, setVisible, openReplay: replay.open };
}
