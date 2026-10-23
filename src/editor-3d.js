import * as THREE from 'three';
import { createTopologyViewer } from './topology-viewer.js';
import { checkedBuffer, createModelLibrary } from './editor-model-loader.js';
import { groundHeight, placementTransform } from './editor-spatial.js';
import { pathPlacements, lineScales, lineAssetMix, lineAssetScales, shuffleLineAssets } from './editor-line.js';
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
  help.textContent = 'Open Keyboard & camera controls in the sidebar for shortcuts and navigation help. Infantry / Mounted explore at player height; Stand here starts from a point you choose. Exploration leaves your loadout unchanged. Existing procedural vegetation is not shown; build measures exact heights and applies biome/weather settings.';
  container.after(info, retry, help);
  const navigate = doc.createElement('button'); navigate.textContent = 'Navigate'; navigate.id = 'editor-navigate';
  doc.querySelector('.modes').prepend(navigate);
  const lineButton = doc.createElement('button'); lineButton.textContent = 'Place on line';
  doc.querySelector('.modes').append(lineButton);
  const linePanel = doc.createElement('section'); linePanel.className = 'editor-line-panel'; linePanel.hidden = true;
  linePanel.innerHTML = '<h3>Place on line · connected path</h3><p>Click the terrain to add connected corners, then Finish path. Drag numbered markers to adjust the route. Green is START, blue marks corners, and orange is the current END.</p><p id="line-path-summary" role="status"></p><button id="line-finish" disabled>Finish path</button><button id="line-remove" disabled>Remove last point</button><button id="line-reset">Clear path</button><fieldset id="line-assets"><legend>Choose favorites for this line</legend><div class="line-asset-row line-asset-head"><span>Asset</span><span>Ratio</span></div><div id="line-favorites"></div></fieldset><p id="line-mix" role="status"></p><button id="line-reroll-assets" disabled>Randomize assets</button><p>Shuffle asset order while keeping the counts shown above. Positions, jitter, and yaw stay fixed; each asset keeps its scale settings.</p><p>Check one or more favorites and set their relative ratios. A 2:1 ratio places about twice as many of the first asset. The Selected summary shows whole-object counts; assets are spread along the line.</p><p id="line-hint" role="status">Click START on the terrain.</p><label>Total number<input id="line-count" type="number" min="1" max="1000" step="1" value="10"></label><label>Jitter (± metres)<input id="line-jitter" type="number" min="0" step="1" value="0"></label><label><input id="line-random-yaw" type="checkbox" checked> Random yaw (0–360°)</label><button id="line-reroll-yaw">Randomize yaw</button><label><input id="line-random-scale" type="checkbox"> Default random scale</label><div class="pair"><label>Low scale<input id="line-scale-low" type="number" min="0.1" max="10" step="0.1" value="0.8"></label><label>High scale<input id="line-scale-high" type="number" min="0.1" max="10" step="0.1" value="1.2"></label></div><button id="line-reroll-scale">Randomize default scales</button><p>Default scale settings apply unless an asset has its own random scale enabled above. Each copy gets an independent scale within its asset’s range.</p><p>Even spacing over the whole path from START to END, with jitter perpendicular to each segment. Total number applies to the whole path. Uses the favorite mix shown above. Turn off random yaw or scale to use the selected rotation or scale.</p><button id="line-randomize">Randomize jitter</button><button id="line-place" disabled>Place assets</button>';
  doc.querySelector('aside').prepend(linePanel);
  let pathNodes = [], pathDrawing = true, linePoints = [], offsets = [], yaws = [], scaleFractions = [];
  const lineSelection = new Map(), lineModels = new Map(), lineScaleOverrides = new Map();
  let favoritesSignature = '', mixSignature = '', assetMix = [];
  function updateLineFavorites() {
    const favorites = project.assets.filter(a => state.favorites?.includes(a.name));
    const signature = JSON.stringify(favorites.map(a => a.name));
    if (signature === favoritesSignature) return;
    favoritesSignature = signature;
    for (const name of lineSelection.keys()) if (!favorites.some(a => a.name === name)) lineSelection.delete(name);
    for (const name of lineScaleOverrides.keys()) if (!favorites.some(a => a.name === name)) lineScaleOverrides.delete(name);
    const list = $('line-favorites'); list.replaceChildren();
    if (!favorites.length) list.textContent = 'No favorites yet. Star assets in the Map assets section below.';
    for (const asset of favorites) {
      const row = doc.createElement('div'); row.className = 'line-asset-row';
      const label = doc.createElement('label'), check = doc.createElement('input');
      check.type = 'checkbox'; check.checked = lineSelection.has(asset.name);
      label.append(check, doc.createTextNode(asset.label));
      const ratio = doc.createElement('input'); ratio.type = 'number'; ratio.min = '0.01'; ratio.step = 'any';
      ratio.value = String(lineSelection.get(asset.name) ?? 1); ratio.disabled = !check.checked;
      ratio.setAttribute('aria-label', `${asset.label} ratio`);
      let config = lineScaleOverrides.get(asset.name);
      if (!config) { config = {enabled:false, low:.8, high:1.2, fractions:[]}; lineScaleOverrides.set(asset.name, config); }
      const scaleBox = doc.createElement('div'); scaleBox.className = 'line-asset-scale'; scaleBox.hidden = !check.checked;
      const scaleLabel = doc.createElement('label'), random = doc.createElement('input');
      random.type = 'checkbox'; random.checked = config.enabled;
      scaleLabel.append(random, doc.createTextNode('Random scale for this asset'));
      const range = doc.createElement('div'); range.className = 'pair';
      const inputs = [];
      for (const [key, title] of [['low', 'Low scale'], ['high', 'High scale']]) {
        const label = doc.createElement('label'), input = doc.createElement('input');
        input.type = 'number'; input.min = '0.1'; input.max = '10'; input.step = '0.1'; input.value = String(config[key]);
        input.disabled = !config.enabled; input.setAttribute('aria-label', `${asset.label} ${title.toLowerCase()}`);
        input.addEventListener('input', () => { config[key] = Number(input.value); refreshLine(); });
        label.append(doc.createTextNode(title), input); range.append(label); inputs.push(input);
      }
      const reroll = doc.createElement('button'); reroll.textContent = 'Randomize this asset’s scale'; reroll.disabled = !config.enabled;
      reroll.setAttribute('aria-label', `Randomize ${asset.label} scale`);
      reroll.addEventListener('click', () => { config.fractions = []; refreshLine(); });
      random.addEventListener('change', () => {
        config.enabled = random.checked; inputs.forEach(input => { input.disabled = !config.enabled; });
        reroll.disabled = !config.enabled; refreshLine();
      });
      scaleBox.append(scaleLabel, range, reroll);
      check.addEventListener('change', () => {
        ratio.disabled = !check.checked; scaleBox.hidden = !check.checked;
        if (check.checked) lineSelection.set(asset.name, Number(ratio.value)); else lineSelection.delete(asset.name);
        refreshLine();
      });
      ratio.addEventListener('input', () => { lineSelection.set(asset.name, Number(ratio.value)); refreshLine(); });
      row.append(label, ratio, scaleBox); list.append(row);
    }
  }
  function loadLineModel(asset) {
    if (lineModels.has(asset)) return;
    const record = {object:null}; lineModels.set(asset, record);
    library.create(asset).then(object => {
      if (disposed || lineModels.get(asset) !== record) return;
      record.object = object; refreshLine();
    }).catch(error => {
      if (disposed || lineModels.get(asset) !== record) return;
      record.error = error; refreshLine(); report(error);
    });
  }
  // Make the map asset palette visible immediately; other settings remain one click away.
  doc.querySelectorAll('aside > details').forEach(el => { el.open = false; });
  let viewer, library, data, manifest, unsubscribe, disposed = false, ready = false, is3D = true, starting = false, modelError = false;
  let state = api.getState(), gesture = null, hover = null, ghost = null, ghostAsset = '', ghostToken = 0, animation = 0;
  const records = new Map(), controller = new AbortController(), pointers = new Set();
  const objects = new THREE.Group(), extras = new THREE.Group();
  const linePreview = new THREE.Group(), lineAssets = new THREE.Group(), pathHover = new THREE.Group(); extras.add(linePreview, lineAssets, pathHover);
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#f5a623', depthTest: false });
  const markerMaterials = ['#258a59', '#287ed1', '#f5a623'].map(color => new THREE.MeshBasicMaterial({color, depthTest:false, side:THREE.DoubleSide}));
  function clearPathHover() {
    for (const child of [...pathHover.children]) { child.geometry.dispose(); child.material.dispose(); pathHover.remove(child); }
  }
  function updatePathHover() {
    clearPathHover();
    if (!ready || !is3D || state.mode !== 'line' || !pathDrawing || !pathNodes.length || !hover || gesture?.pathNode !== undefined) { viewer?.draw(); return; }
    const start = pathNodes.at(-1);
    const vertices = Array.from({length:33}, (_, i) => {
      const t = i / 32, x = start.x + (hover.x - start.x) * t, y = start.y + (hover.y - start.y) * t;
      return new THREE.Vector3(x, y, groundHeight(data,x,y) + .3);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), new THREE.LineDashedMaterial({color:'#f5a623', depthTest:false, dashSize:2, gapSize:1}));
    line.computeLineDistances(); line.renderOrder = 13; pathHover.add(line); viewer.draw();
  }
  function clearLinePreview() {
    // Preview clones share model geometry and materials owned by the model library.
    lineAssets.clear();
    for (const child of [...linePreview.children]) {
      child.geometry?.dispose();
      if (child.isSprite) { child.material.map.dispose(); child.material.dispose(); }
      linePreview.remove(child);
    }
    clearPathHover();
  }
  function refreshLine() {
    updateLineFavorites();
    let mix = [];
    $('line-reroll-assets').disabled = true;
    try {
      const entries = [...lineSelection].map(([asset, ratio]) => ({asset, ratio})), count = Number($('line-count').value);
      const base = lineAssetMix(entries, count), signature = JSON.stringify({entries, count});
      if (signature !== mixSignature) { assetMix = base; mixSignature = signature; }
      mix = assetMix;
      $('line-reroll-assets').disabled = new Set(mix).size < 2;
      $('line-mix').textContent = 'Selected: ' + [...lineSelection.keys()].map(name => `${project.assets.find(a => a.name === name).label} × ${mix.filter(a => a === name).length}`).join(' · ');
    } catch (error) { $('line-mix').textContent = error.message; }
    clearLinePreview(); viewer?.draw(); linePoints = []; $('line-place').disabled = true;
    linePanel.hidden = !is3D || state.mode !== 'line';
    lineButton.setAttribute('aria-pressed', state.mode === 'line');
    if (!ready || linePanel.hidden) return;
    const hint = $('line-hint');
    const length = pathNodes.slice(1).reduce((sum,p,i) => sum + Math.hypot(p.x-pathNodes[i].x,p.y-pathNodes[i].y),0);
    $('line-path-summary').textContent = `${Math.max(0,pathNodes.length-1)} segments · ${pathNodes.length} points · ${length.toFixed(1)} m`;
    $('line-finish').disabled = pathNodes.length < 2;
    $('line-finish').textContent = pathDrawing ? 'Finish path' : 'Extend path';
    $('line-finish').setAttribute('aria-pressed', !pathDrawing);
    $('line-remove').disabled = !pathNodes.length;
    hint.textContent = !pathNodes.length ? 'Click START on the terrain.' : pathDrawing ? 'Click to add the next corner, or Finish path to place assets.' : 'Path ready. Drag markers to adjust it, or Extend path to add corners.';
    pathNodes.forEach((point,i) => {
      const kind = i === 0 ? 0 : i === pathNodes.length-1 ? 2 : 1;
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(3,24), markerMaterials[kind]);
      mesh.position.set(point.x,point.y,groundHeight(data,point.x,point.y)+.3);
      mesh.renderOrder = 14; mesh.userData.pathNode = i; linePreview.add(mesh);
      const canvas = doc.createElement('canvas'); canvas.width = 256; canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = ['#17613d','#18538e','#925000'][kind]; ctx.fillRect(0,0,256,80);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${i+1} · ${i===0 ? 'START' : i===pathNodes.length-1 ? 'END' : 'CORNER'}`,128,40);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,depthWrite:false,toneMapped:false,fog:false}));
      label.position.copy(mesh.position); label.position.z += 5; label.center.set(.5,0);
      const viewPoint=new THREE.Vector3();
      // Keep badges legible at overview zoom and in the overhead camera.
      label.onBeforeRender=(renderer,scene,camera)=>{
        viewPoint.copy(label.position).applyMatrix4(camera.matrixWorldInverse);
        const unitsPerPixel=2*(camera.isPerspectiveCamera ? Math.max(.1,-viewPoint.z) : 1)/(camera.projectionMatrix.elements[5]*viewer.canvas.clientHeight);
        label.scale.set(96*unitsPerPixel,30*unitsPerPixel,1); label.updateMatrixWorld();
      };
      label.renderOrder = 15; label.userData.pathNode = i; linePreview.add(label);
    });
    // Draw the route even before assets are chosen or all model previews have loaded.
    for (let segment=1; segment<pathNodes.length; segment++) {
      const start=pathNodes[segment-1], end=pathNodes[segment];
      const vertices=Array.from({length:65},(_,i)=>{
        const t=i/64,x=start.x+(end.x-start.x)*t,y=start.y+(end.y-start.y)*t;
        return new THREE.Vector3(x,y,groundHeight(data,x,y)+.25);
      });
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices),lineMaterial);
      line.renderOrder=12; linePreview.add(line);
    }
    updatePathHover();
    if (pathNodes.length<2) { viewer.draw(); return; }
    try {
      if (!mix.length) throw new Error($('line-mix').textContent);
      const count = Number($('line-count').value), jitter = Number($('line-jitter').value);
      while (offsets.length < Math.min(count, 1000)) offsets.push(Math.random() * 2 - 1);
      while (yaws.length < Math.min(count, 1000)) yaws.push(Math.random() * 360);
      while (scaleFractions.length < Math.min(count, 1000)) scaleFractions.push(Math.random());
      for (const asset of new Set(mix)) {
        const config = lineScaleOverrides.get(asset);
        if (config?.enabled) while (config.fractions.length < count) config.fractions.push(Math.random());
      }
      const defaultScales = $('line-random-scale').checked
        ? lineScales(Number($('line-scale-low').value), Number($('line-scale-high').value), scaleFractions)
        : Array(count).fill(state.brush.scale);
      const scales = lineAssetScales(mix, lineScaleOverrides, defaultScales);
      linePoints = pathPlacements(pathNodes, count, jitter, offsets).map((p, i) => ({
        ...p, asset: mix[i], yaw_deg: $('line-random-yaw').checked ? yaws[i] : state.brush.yaw_deg,
        scale: scales[i],
      }));
      const bounds = project.bounds;
      if (linePoints.some(p => p.x_m < bounds.x_min_m || p.x_m > bounds.x_max_m || p.y_m < bounds.y_min_m || p.y_m > bounds.y_max_m)) throw new Error('Jitter extends outside the terrain. Reduce jitter or adjust the path markers.');
      for (const asset of new Set(mix)) loadLineModel(asset);
      const failed = mix.find(asset => lineModels.get(asset)?.error);
      if (failed) throw new Error('A selected asset could not load. Click Retry models.');
      if (mix.some(asset => !lineModels.get(asset)?.object)) {
        hint.textContent += ' Loading selected asset previews…';
        return;
      }
      for (const p of linePoints) {
        const object = lineModels.get(p.asset).object.clone(true); object.visible = true;
        transform(object, p); lineAssets.add(object);
      }
      $('line-place').disabled = pathDrawing;
    } catch (error) { hint.textContent = error.message; }
    viewer.draw();
  }
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
      extras.add(ghost); updateGhost(); refreshLine();
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
    if (viewer.mode === 'orbit') viewer.canvas.style.cursor = ['place', 'line'].includes(state.mode) ? 'crosshair' : state.mode === 'select' ? 'pointer' : 'grab';
    viewer.updateSpawns(state.document.spawn_points.map(p => ({ ...p, z_m: groundHeight(data, p.x_m, p.y_m) })));
    selectionBox(); loadGhost(); updateGhost(); refreshLine();
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
    if (cancel && gesture?.pathNode !== undefined) { pathNodes[gesture.pathNode] = gesture.original; refreshLine(); }
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
    if (event.button !== 0 || (state.mode === 'navigate' && !event.altKey) || !ready) return;
    viewer.canvas.focus({ preventScroll: true });
    const hit = ground(event), id = state.mode === 'line' ? null : objectAt(event);
    if (event.altKey && !id) return;
    gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode: state.mode, id, moved: false };
    if (state.mode === 'line') {
      const marker = viewer.pick(event.clientX,event.clientY,linePreview.children.filter(child => child.userData.pathNode !== undefined))[0]?.object;
      if (marker) {
        gesture.pathNode=marker.userData.pathNode; gesture.original={...pathNodes[gesture.pathNode]};
        gesture.pathOffset=hit ? {x:gesture.original.x-hit.x,y:gesture.original.y-hit.y} : {x:0,y:0};
        viewer.enabled(false);
      }
    }
    if (id) {
      const point = state.document.placements.find(p => p.id === id);
      gesture.vertical = event.altKey; gesture.originalPlacement = {...point};
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
      if (gesture.pathNode !== undefined && gesture.moved && hover) {
        const candidate=pathNodes.map((p,i)=>i===gesture.pathNode ? {x:hover.x+gesture.pathOffset.x,y:hover.y+gesture.pathOffset.y} : p);
        if (candidate.slice(1).every((p,i)=>Math.hypot(p.x-candidate[i].x,p.y-candidate[i].y)>=.001)) {
          pathNodes=candidate; refreshLine();
        }
      }
      if (gesture.id && gesture.moved && (hover || gesture.vertical)) {
        try {
          if (gesture.vertical) {
            const p=gesture.originalPlacement;
            api.moveTo(p.x_m,p.y_m,(p.z_offset_m ?? 0)+(gesture.y-event.clientY)*.05);
          } else api.moveTo(hover.x + gesture.offset.x, hover.y + gesture.offset.y);
        } catch (error) { api.status(error.message, true); }
      }
    }
    updateGhost(); updatePathHover();
  }
  function pointerUp(event) {
    pointers.delete(event.pointerId);
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const action = gesture;
    if (action.id) api.finishMove(event.type === 'pointercancel');
    if (action.pathNode !== undefined && event.type === 'pointercancel') { pathNodes[action.pathNode]=action.original; refreshLine(); }
    gesture = null; viewer.enabled(true);
    if (event.type !== 'pointercancel' && !action.id && action.pathNode === undefined && !action.moved) {
      const hit = ground(event);
      if (action.mode === 'line') {
        if (!hit || !pathDrawing) return;
        const previous=pathNodes.at(-1);
        if (previous && Math.hypot(hit.x-previous.x,hit.y-previous.y)<.001) { api.status('Choose a different point for the next corner.',true); return; }
        pathNodes.push({x:hit.x,y:hit.y});
        refreshLine(); viewer.draw();
      }
      else if (action.mode === 'select') api.select(null);
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
    for (const element of [container, cameraRow, info, help, navigate, lineButton]) element.hidden = !three;
    retry.hidden = !three || !modelError;
    $('editor-view-3d').setAttribute('aria-pressed', three); $('editor-view-2d').setAttribute('aria-pressed', !three);
    if (!three && ['navigate', 'line'].includes(api.getState().mode)) api.setMode('select');
    if (three) { viewer?.resize(); if (!ready) start(); }
    updateGhost(); refreshLine();
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
      viewer.canvas.addEventListener('pointerleave', () => { if (!gesture) { hover = null; updateGhost(); updatePathHover(); } });
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
    clearLinePreview(); lineMaterial.dispose(); markerMaterials.forEach(material => material.dispose()); discardGhost(); selection.dispose(); cursor.geometry.dispose(); cursor.material.dispose(); library?.dispose(); viewer?.dispose();
    doc.body.classList.remove('editing-3d'); $('viewport').hidden = false;
    for (const element of [style, row, cameraRow, container, info, retry, help, navigate, lineButton, linePanel]) element.remove();
  }
  lineButton.addEventListener('click', () => { viewer?.exitExplorer(); api.setMode('line'); });
  for (const id of ['line-count', 'line-jitter', 'line-scale-low', 'line-scale-high']) $(id).addEventListener('input', refreshLine);
  $('line-random-scale').addEventListener('change', refreshLine);
  $('line-reroll-scale').addEventListener('click', () => {
    $('line-random-scale').checked = true; scaleFractions = []; refreshLine();
  });
  $('line-random-yaw').addEventListener('change', refreshLine);
  $('line-reroll-yaw').addEventListener('click', () => {
    $('line-random-yaw').checked = true; yaws = []; refreshLine();
  });
  $('line-reroll-assets').addEventListener('click', () => { assetMix = shuffleLineAssets(assetMix); refreshLine(); });
  $('line-randomize').addEventListener('click', () => { offsets = []; refreshLine(); });
  $('line-finish').addEventListener('click', () => { pathDrawing = !pathDrawing; refreshLine(); });
  $('line-remove').addEventListener('click', () => { pathNodes.pop(); if (pathNodes.length<2) pathDrawing=true; refreshLine(); });
  $('line-reset').addEventListener('click', () => { pathNodes = []; pathDrawing=true; refreshLine(); viewer?.draw(); });
  $('line-place').addEventListener('click', () => {
    try { if (pathDrawing) throw new Error('Finish the path first.'); api.placeBatch(linePoints); pathNodes = []; pathDrawing=true; refreshLine(); viewer.draw(); }
    catch (error) { api.status(error.message, true); }
  });
  navigate.addEventListener('click', () => api.setMode('navigate'));
  for (const button of [navigate, $('place'), $('select')]) button.addEventListener('click', () => viewer?.exitExplorer(), { signal: controller.signal });
  $('editor-view-3d').addEventListener('click', () => show(true)); $('editor-view-2d').addEventListener('click', () => show(false));
  $('editor-camera').addEventListener('change', () => { cancelGesture(); viewer?.preset($('editor-camera').value); });
  $('editor-reset').addEventListener('click', () => { $('editor-camera').value = 'aerial'; viewer?.preset('aerial'); });
  $('editor-focus').addEventListener('click', () => { viewer?.exitExplorer(); selectionBox(); if (selection.visible) viewer.focus(selection.box); });
  $('editor-contours').addEventListener('click', () => { const value = $('editor-contours').getAttribute('aria-pressed') !== 'true'; $('editor-contours').setAttribute('aria-pressed', value); viewer?.contours(value); });
  $('editor-three-retry').addEventListener('click', () => {
    lineModels.clear(); records.clear(); objects.clear(); discardGhost(); ghostAsset = ''; ++ghostToken; start();
  });
  retry.addEventListener('click', () => {
    for (const [asset, record] of lineModels) if (record.error) lineModels.delete(asset);
    modelError = false; retry.hidden = true; ghostAsset = ''; ++ghostToken;
    for (const [id, record] of records) if (record.failed) records.delete(id);
    schedule(api.getState());
  });
  win.addEventListener('pagehide', dispose, { once: true, signal: controller.signal });
  show(frame.dataset.editorView !== '2d');
  return { dispose };
}
