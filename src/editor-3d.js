import * as THREE from 'three';
import { createTopologyViewer } from './topology-viewer.js';
import { checkedBuffer, createModelLibrary } from './editor-model-loader.js';
import { groundHeight, placementTransform } from './editor-spatial.js';
import styles from './editor-3d.css?inline';

export function attachEditor3D(frame, project, topology, models, assetURL) {
  const doc = frame.contentDocument, win = frame.contentWindow, api = win.MapEditor;
  if (!api) throw new Error('Editor state is unavailable');
  const $ = id => doc.getElementById(id);
  const style = doc.createElement('style'); style.textContent = styles; doc.head.append(style);
  const row = doc.createElement('div'); row.className = 'editor-viewbar';
  row.innerHTML = '<button id="editor-view-3d" aria-pressed="true">3D terrain</button><button id="editor-view-2d" aria-pressed="false">2D heatmap</button><span class="scale-note">World metres · true scale 1:1</span>';
  const toolbar = doc.querySelector('.toolbar'); toolbar.before(row);
  const cameraRow = doc.createElement('div'); cameraRow.className = 'editor-camera';
  cameraRow.innerHTML = '<label for="editor-camera">Overview</label><select id="editor-camera"><option value="aerial">Aerial</option><option value="reverse">Reverse aerial</option><option value="overhead">Overhead</option><option value="team1">Team 1 looking in</option><option value="team2">Team 2 looking in</option></select><button id="editor-focus" disabled>Focus selected</button><button id="editor-reset">Fit map</button><button id="editor-contours" aria-pressed="false">Contours</button>';
  toolbar.after(cameraRow);
  const container = doc.createElement('div'); container.id = 'editor-three';
  container.innerHTML = '<div id="editor-three-message" role="status"><span id="editor-three-loading">Loading measured terrain…</span><button id="editor-three-retry" hidden>Retry 3D</button></div>';
  cameraRow.after(container);
  const info = doc.createElement('p'); info.className = 'editor-model-info'; info.setAttribute('role', 'status');
  const retry = doc.createElement('button'); retry.textContent = 'Retry models'; retry.hidden = true;
  const help = doc.createElement('p'); help.className = 'editor-three-help';
  help.textContent = 'Navigate: drag to orbit, scroll to zoom, right-drag to pan. Place / Select: left-click or drag an object; right-drag to orbit (Shift to pan). Infantry / Mounted explore at player height; Stand here starts from a point you choose. Exploration leaves your loadout unchanged. Existing procedural vegetation is not shown; build measures exact heights and applies biome/weather settings.';
  container.after(info, retry, help);
  const navigate = doc.createElement('button'); navigate.textContent = 'Navigate'; navigate.id = 'editor-navigate';
  doc.querySelector('.modes').prepend(navigate);
  // Make the map asset palette visible immediately; other settings remain one click away.
  doc.querySelectorAll('aside > details').forEach(el => { el.open = false; });
  let viewer, library, data, manifest, unsubscribe, disposed = false, ready = false, is3D = true, starting = false, modelError = false;
  let state = api.getState(), gesture = null, hover = null, ghost = null, ghostAsset = '', ghostToken = 0, animation = 0;
  const records = new Map(), controller = new AbortController(), pointers = new Set();
  const objects = new THREE.Group(), extras = new THREE.Group();
  const selection = new THREE.Box3Helper(new THREE.Box3(), '#e27d19'); selection.visible = false; extras.add(selection);
  const cursor = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 32), new THREE.MeshBasicMaterial({ color: '#f5a623', side: THREE.DoubleSide, depthTest: false }));
  cursor.visible = false; cursor.renderOrder = 10; extras.add(cursor);

  function report(error) { modelError = true; info.textContent = error.message || String(error); info.classList.add('error'); retry.hidden = !is3D; }
  function transform(object, point) {
    const t = placementTransform(data, point, manifest.assets[point.asset]);
    object.position.fromArray(t.position); object.rotation.set(0, 0, t.yaw); object.scale.setScalar(t.scale); object.updateMatrixWorld(true);
  }
  function selectionBox() {
    const object = records.get(state.selected)?.object;
    selection.visible = Boolean(object) && viewer?.mode === 'orbit'; $('editor-focus').disabled = !object;
    if (object) selection.box.setFromObject(object);
  }
  function discardGhost() {
    if (!ghost) return;
    extras.remove(ghost); ghost.traverse(child => { if (child.isMesh) child.material.dispose(); }); ghost = null;
  }
  function updateGhost() {
    const valid = is3D && viewer?.mode === 'orbit' && state.mode === 'place' && hover && Number.isFinite(state.brush.scale) && state.brush.scale >= .1 && state.brush.scale <= 10 && Number.isFinite(state.brush.yaw_deg);
    cursor.visible = Boolean(valid);
    if (hover) cursor.position.set(hover.x, hover.y, hover.z + .08);
    if (ghost) {
      ghost.visible = Boolean(valid && ghostAsset === state.brush.asset);
      if (ghost.visible) transform(ghost, { ...state.brush, x_m: hover.x, y_m: hover.y });
    }
    viewer?.draw();
  }
  function loadGhost() {
    const asset = state.brush.asset;
    if (ghostAsset === asset) return;
    ghostAsset = asset; const token = ++ghostToken; discardGhost();
    if (!asset) return;
    library.create(asset).then(object => {
      if (disposed || token !== ghostToken) return;
      ghost = object;
      ghost.traverse(child => { if (child.isMesh) { child.material = child.material.clone(); child.material.transparent = true; child.material.opacity = .55; child.material.depthWrite = false; child.castShadow = false; } });
      extras.add(ghost); updateGhost();
    }).catch(error => { if (!disposed && token === ghostToken) report(error); });
  }
  function sync() {
    animation = 0;
    if (!ready || disposed) return;
    const points = state.document.placements, ids = new Set(points.map(p => p.id));
    for (const [id, record] of records) if (!ids.has(id)) { if (record.object) objects.remove(record.object); records.delete(id); }
    for (const point of points) {
      let record = records.get(point.id);
      if (record && record.asset !== point.asset) { if (record.object) objects.remove(record.object); records.delete(point.id); record = null; }
      if (!record) {
        record = { asset: point.asset, object: null }; records.set(point.id, record);
        const pending = record;
        library.create(point.asset).then(object => {
          if (disposed || records.get(point.id) !== pending) return;
          const latest = state.document.placements.find(p => p.id === point.id);
          if (!latest) return;
          pending.object = object; object.userData.placementId = point.id;
          transform(object, latest); objects.add(object); selectionBox(); viewer.draw();
        }).catch(error => { if (!disposed && records.get(point.id) === pending) { pending.failed = true; report(error); } });
      }
      if (record.object) transform(record.object, point);
    }
    viewer.navigation(state.mode === 'navigate'); navigate.setAttribute('aria-pressed', state.mode === 'navigate');
    if (viewer.mode === 'orbit') viewer.canvas.style.cursor = state.mode === 'place' ? 'crosshair' : state.mode === 'select' ? 'pointer' : 'grab';
    viewer.updateSpawns(state.document.spawn_points.map(p => ({ ...p, z_m: groundHeight(data, p.x_m, p.y_m) })));
    selectionBox(); loadGhost(); updateGhost();
    const dimensions = library.dimensions(state.brush.asset, state.brush.scale);
    if (!modelError) {
      info.classList.remove('error');
      info.textContent = dimensions && dimensions.every(Number.isFinite)
        ? `Asset size: ${dimensions[0].toFixed(2)} × ${dimensions[1].toFixed(2)} × ${dimensions[2].toFixed(2)} m (width × depth × height) · scale ${state.brush.scale}×`
        : 'Choose an asset from the palette.';
    }
  }
  function schedule(value) { state = value; if (!animation) animation = win.requestAnimationFrame(sync); }
  function cancelGesture(cancel = true) {
    if (gesture?.id) api.finishMove(cancel);
    gesture = null; viewer?.enabled(true);
  }
  function ground(event) { return viewer.pick(event.clientX, event.clientY)[0]?.point || null; }
  function objectAt(event) {
    const hit = viewer.pick(event.clientX, event.clientY, [...records.values()].flatMap(r => r.object ? [r.object] : []))[0];
    let object = hit?.object;
    while (object && !object.userData.placementId) object = object.parent;
    return object?.userData.placementId || null;
  }
  function pointerDown(event) {
    if (viewer.mode !== 'orbit') return;
    pointers.add(event.pointerId);
    if (pointers.size > 1) { cancelGesture(); return; }
    if (event.button !== 0 || state.mode === 'navigate' || !ready) return;
    viewer.canvas.focus({ preventScroll: true });
    const hit = ground(event), id = objectAt(event);
    gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode: state.mode, id, moved: false };
    if (id) {
      const point = state.document.placements.find(p => p.id === id);
      gesture.offset = hit ? { x: point.x_m - hit.x, y: point.y_m - hit.y } : { x: 0, y: 0 };
      api.beginMove(id); viewer.enabled(false);
    }
    viewer.canvas.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function pointerMove(event) {
    if (viewer.mode !== 'orbit') return;
    hover = ground(event);
    if (hover) $('coordinates').textContent = `X ${hover.x.toFixed(3)} · Y ${hover.y.toFixed(3)} · Z ${hover.z.toFixed(2)} m`;
    if (gesture?.pointer === event.pointerId) {
      gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4;
      if (gesture.id && gesture.moved && hover) {
        try { api.moveTo(hover.x + gesture.offset.x, hover.y + gesture.offset.y); } catch (error) { api.status(error.message, true); }
      }
    }
    updateGhost();
  }
  function pointerUp(event) {
    pointers.delete(event.pointerId);
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const action = gesture;
    if (action.id) api.finishMove(event.type === 'pointercancel');
    gesture = null; viewer.enabled(true);
    if (event.type !== 'pointercancel' && !action.id && !action.moved) {
      const hit = ground(event);
      if (action.mode === 'select') api.select(null);
      else if (hit) {
        if (!ghost || ghostAsset !== state.brush.asset) { api.status('Wait for the selected asset model to load, or retry models.', true); return; }
        try { api.placeAt(hit.x, hit.y); } catch (error) { api.status(error.message, true); }
      }
    }
  }
  function keys(event) {
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) cancelGesture();
  }
  function show(three) {
    cancelGesture(); is3D = three;
    frame.dataset.editorView = three ? '3d' : '2d';
    if (!three) viewer?.exitExplorer();
    doc.body.classList.toggle('editing-3d', three);
    $('viewport').hidden = three;
    for (const element of [container, cameraRow, info, help, navigate]) element.hidden = !three;
    retry.hidden = !three || !modelError;
    $('editor-view-3d').setAttribute('aria-pressed', three); $('editor-view-2d').setAttribute('aria-pressed', !three);
    if (!three && api.getState().mode === 'navigate') api.setMode('select');
    if (three) { viewer?.resize(); if (!ready) start(); }
    updateGhost();
  }
  async function start() {
    if (starting || disposed) return; starting = true;
    $('editor-three-retry').hidden = true; $('editor-three-message').hidden = false;
    $('editor-three-loading').textContent = 'Loading measured terrain and native assets…';
    try {
      const [terrainBytes, modelBytes] = await Promise.all([
        checkedBuffer(assetURL(topology.url), topology.sha256, controller.signal),
        checkedBuffer(assetURL(models.manifest_url), models.manifest_sha256, controller.signal),
      ]);
      if (disposed) return;
      data = JSON.parse(new TextDecoder().decode(terrainBytes)); manifest = JSON.parse(new TextDecoder().decode(modelBytes));
      const registered = models.maps.find(m => m.id === project.source.scene_id);
      for (const key of ['sco_sha256', 'recipe_sha256', 'terrain_code']) {
        if (data.source[key] !== project.source[key] || registered?.source[key] !== project.source[key]) throw new Error('3D data belongs to a different map revision.');
      }
      for (const asset of project.assets) if (manifest.assets[asset.name]?.mesh !== asset.mesh || manifest.assets[asset.name]?.ground_offset_m !== asset.ground_offset_m) throw new Error('3D asset definitions have changed.');
      library = createModelLibrary(manifest, assetURL(models.manifest_url));
      viewer = createTopologyViewer(container, data, message => {
        ready = false; cancelGesture(); unsubscribe?.(); unsubscribe = null; viewer?.dispose(); library?.dispose();
        $('editor-three-loading').textContent = message; $('editor-three-message').hidden = false; $('editor-three-retry').hidden = false;
      }, { editing: true, onModeChange(mode) {
        cancelGesture(); hover = null; extras.visible = mode === 'orbit';
        $('editor-camera').disabled = $('editor-contours').disabled = mode === 'explore';
        selectionBox(); updateGhost();
      } });
      viewer.canvas.setAttribute('aria-label', '3D map editor. Navigate, place map assets or select and drag objects.');
      viewer.addLayer(objects); viewer.addLayer(extras);
      viewer.canvas.addEventListener('pointerdown', pointerDown);
      viewer.canvas.addEventListener('pointermove', pointerMove);
      viewer.canvas.addEventListener('pointerup', pointerUp);
      viewer.canvas.addEventListener('pointercancel', pointerUp);
      viewer.canvas.addEventListener('pointerleave', () => { if (!gesture) { hover = null; updateGhost(); } });
      viewer.canvas.addEventListener('dblclick', event => {
        if (viewer.mode !== 'orbit' || state.mode !== 'navigate') return;
        const point = ground(event);
        if (point) viewer.focus(new THREE.Box3().setFromCenterAndSize(point, new THREE.Vector3(35, 35, 12)));
      });
      doc.addEventListener('keydown', keys, true);
      win.addEventListener('blur', blur);
      ready = true; $('editor-three-message').hidden = true;
      viewer.contours($('editor-contours').getAttribute('aria-pressed') === 'true');
      if ($('editor-camera').value !== 'aerial') viewer.preset($('editor-camera').value);
      if (is3D && !frame.dataset.editor3dOpened) api.setMode('navigate');
      frame.dataset.editor3dOpened = 'true'; unsubscribe = api.subscribe(schedule);
    } catch (error) {
      if (!disposed) { viewer?.dispose(); library?.dispose(); $('editor-three-loading').textContent = error.message; $('editor-three-retry').hidden = false; }
    } finally { starting = false; }
  }
  function blur() { pointers.clear(); cancelGesture(); }
  function dispose() {
    if (disposed) return; disposed = true; cancelGesture(); controller.abort(); unsubscribe?.();
    win.cancelAnimationFrame(animation); doc.removeEventListener('keydown', keys, true); win.removeEventListener('blur', blur);
    discardGhost(); selection.dispose(); cursor.geometry.dispose(); cursor.material.dispose(); library?.dispose(); viewer?.dispose();
    doc.body.classList.remove('editing-3d'); $('viewport').hidden = false;
    for (const element of [style, row, cameraRow, container, info, retry, help, navigate]) element.remove();
  }
  navigate.addEventListener('click', () => api.setMode('navigate'));
  for (const button of [navigate, $('place'), $('select')]) button.addEventListener('click', () => viewer?.exitExplorer(), { signal: controller.signal });
  $('editor-view-3d').addEventListener('click', () => show(true)); $('editor-view-2d').addEventListener('click', () => show(false));
  $('editor-camera').addEventListener('change', () => { cancelGesture(); viewer?.preset($('editor-camera').value); });
  $('editor-reset').addEventListener('click', () => { $('editor-camera').value = 'aerial'; viewer?.preset('aerial'); });
  $('editor-focus').addEventListener('click', () => { viewer?.exitExplorer(); selectionBox(); if (selection.visible) viewer.focus(selection.box); });
  $('editor-contours').addEventListener('click', () => { const value = $('editor-contours').getAttribute('aria-pressed') !== 'true'; $('editor-contours').setAttribute('aria-pressed', value); viewer?.contours(value); });
  $('editor-three-retry').addEventListener('click', () => {
    records.clear(); objects.clear(); discardGhost(); ghostAsset = ''; ++ghostToken; start();
  });
  retry.addEventListener('click', () => {
    modelError = false; retry.hidden = true; ghostAsset = ''; ++ghostToken;
    for (const [id, record] of records) if (record.failed) records.delete(id);
    schedule(api.getState());
  });
  win.addEventListener('pagehide', dispose, { once: true, signal: controller.signal });
  show(frame.dataset.editorView !== '2d');
  return { dispose };
}
