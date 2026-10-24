import { elevationPalettes } from './terrain-palettes.js';
import { createExplorerState, stepExplorer, turnExplorer } from './terrain-explorer-motion.js';

export function createTerrainExperience(container, data, api, styles = '') {
  const doc = container.ownerDocument, win = doc.defaultView, canvas = api.canvas;
  if (!doc.querySelector('style[data-terrain-experience]')) {
    const style = doc.createElement('style'); style.dataset.terrainExperience = ''; style.textContent = styles; doc.head.append(style);
  }
  const ui = doc.createElement('div'); ui.className = 'terrain-experience';
  ui.innerHTML = `<div class="terrain-tools">
    <details class="terrain-graphics"><summary>Lighting & fog</summary>
      <label>Surface <select data-ui="surface"><option value="elevation">Elevation</option><option value="natural">Natural</option></select></label>
      <label>Elevation palette <select data-ui="palette">${Object.entries(elevationPalettes).map(([value, palette]) => `<option value="${value}">${palette.label}</option>`).join('')}</select></label>
      <label>Sun direction <input data-ui="sun" type="range" min="0" max="360" value="135" aria-label="Sun direction in degrees"></label>
      <label>Distance haze <input data-ui="haze" type="checkbox" checked></label>
      <label>Fog level <select data-ui="fog"><option value="source">Keep source fog</option><option value="none">No fog</option><option value="low">Low (600 m)</option><option value="medium">Medium (450 m)</option><option value="dense">Dense (300 m)</option></select></label>
      <p class="terrain-fog-note">White fog · approximate Warband falloff. Preview only; Keep source fog retains the preview’s distance haze.</p>
      <label>Shadows <input data-ui="shadows" type="checkbox" checked></label>
    </details>
    <div class="terrain-experience-actions" role="group" aria-label="Explore the map">
      <button data-ui="explore" aria-pressed="false">Explore on foot</button>
      <button data-ui="pick" aria-pressed="false">Stand here</button><button data-ui="exit" hidden>Exit explorer</button>
    </div></div>
    <div class="terrain-pick-note" data-ui="pick-note" hidden>Click the terrain to stand there.<br>Escape cancels.</div>
    <div class="terrain-crosshair" data-ui="crosshair" hidden aria-hidden="true"></div>
    <div class="terrain-minimap" data-ui="minimap-wrap" hidden><canvas data-ui="minimap" width="320" height="320" tabindex="0" role="img" aria-label="Explorer overview. Click to move here; orange arrow shows your position and facing."></canvas><p>↑ +Y · blue/red: teams · orange: you<br>Click to relocate</p></div>
    <div class="terrain-move-pad" data-ui="pad" role="group" aria-label="Move explorer" hidden>
      <button data-move="forward" aria-label="Move forward">↑</button><button data-move="left" aria-label="Move left">←</button><button data-move="back" aria-label="Move backward">↓</button><button data-move="right" aria-label="Move right">→</button>
    </div>`;
  container.append(ui);
  const $ = name => ui.querySelector(`[data-ui="${name}"]`), mini = $('minimap'), ctx = mini.getContext('2d');
  let mode = 'orbit', state = null, following = false, disposed = false, raf = 0, lastTime = 0, pointer = null, jump = false;
  const keys = new Set(), pad = new Set(), listeners = [];
  function listen(target, event, fn, options) { target.addEventListener(event, fn, options); listeners.push(() => target.removeEventListener(event, fn, options)); }
  const mapImage = doc.createElement('canvas'), n = data.grid_size; mapImage.width = mapImage.height = n;
  const imageContext = mapImage.getContext('2d'), pixels = imageContext.createImageData(n, n);
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    const value = (data.heights_mm[x * n + y] / 1000 - data.min_height_m) / Math.max(.01, data.relief_m);
    const i = ((n - 1 - y) * n + x) * 4;
    pixels.data.set([92 + value * 101, 121 + value * 71, 103 + value * 45, 255], i);
  }
  imageContext.putImageData(pixels, 0, 0);
  const mapXY = p => ({ x: (p.x - data.xs[0]) / (data.xs.at(-1) - data.xs[0]) * 320, y: (1 - (p.y - data.ys[0]) / (data.ys.at(-1) - data.ys[0])) * 320 });
  function map() {
    if (!state || mode !== 'explore') return;
    ctx.drawImage(mapImage, 0, 0, 320, 320);
    for (const [i, spawn] of api.spawns().entries()) {
      const p = mapXY({ x: spawn.x_m, y: spawn.y_m });
      ctx.fillStyle = i ? '#e75a4d' : '#2e7be5'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(String(i + 1), p.x, p.y);
    }
    const p = mapXY(state);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(state.yaw);
    ctx.fillStyle = '#f3a33155'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 40, -Math.PI / 2 - .52, -Math.PI / 2 + .52); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffb437'; ctx.strokeStyle = '#273f38'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 5); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    // A 100 m bar makes the overview usable at any map size.
    const bar = Math.min(140, 100 / (data.xs.at(-1) - data.xs[0]) * 320);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(12, 300); ctx.lineTo(12 + bar, 300); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`${Math.round(bar / 320 * (data.xs.at(-1) - data.xs[0]))} m`, 12, 288);
  }
  function paint() {
    if (!state || mode !== 'explore' || disposed) return;
    api.frame(state); map();
  }
  function notify() {
    const exploring = mode === 'explore';
    for (const name of ['crosshair', 'minimap-wrap', 'pad']) $(name).hidden = !exploring;
    $('pad').hidden = !exploring || following;
    $('exit').textContent = following ? 'Exit soldier view' : 'Exit explorer';
    mini.setAttribute('aria-label', following ? 'Followed soldier position and facing' : 'Explorer overview. Click to move here; orange arrow shows your position and facing.');
    $('minimap-wrap').querySelector('p').innerHTML = `↑ +Y · blue/red: teams · orange: you<br>${following ? 'Following recorded soldier' : 'Click to relocate'}`;
    $('exit').hidden = mode === 'orbit'; $('pick-note').hidden = mode !== 'pick';
    $('pick').setAttribute('aria-pressed', mode === 'pick');
    $('explore').setAttribute('aria-pressed', exploring);
    canvas.style.cursor = mode === 'pick' ? 'crosshair' : exploring ? 'crosshair' : '';
    api.modeChanged(mode);
    container.dispatchEvent(new win.CustomEvent('terrain-modechange', { detail: { mode } }));
  }
  function pause() { keys.clear(); pad.clear(); jump = false; pointer = null; win.cancelAnimationFrame(raf); raf = 0; lastTime = 0; if (state) state.speed = 0; }
  function releaseFollow() {
    if (!following) return;
    following = false; api.followEnded?.();
  }
  function exit() {
    if (mode === 'orbit') return;
    releaseFollow();
    const wasExploring = mode === 'explore'; pause(); mode = 'orbit';
    if (wasExploring) api.end(); notify();
  }
  function spawnPoint(index = 0) {
    const spawns = api.spawns(), p = spawns[index], q = spawns[1 - index];
    return { point: { x: p.x_m, y: p.y_m }, yaw: Math.atan2(q.x_m - p.x_m, q.y_m - p.y_m) };
  }
  function enter(point, yaw) {
    releaseFollow();
    if (mode !== 'explore' || point) {
      if (mode !== 'explore') api.begin();
      const start = point ? { point, yaw: yaw ?? state?.yaw ?? 0 } : state ? { point: state, yaw: state.yaw } : spawnPoint();
      state = createExplorerState(data, start.point, start.yaw);
    }
    mode = 'explore';
    notify(); paint(); canvas.focus({ preventScroll: true });
  }
  function follow(point) {
    if (disposed) return;
    const starting = !following;
    pause();
    if (mode !== 'explore') api.begin();
    following = true; mode = 'explore';
    // Recorded altitude preserves mounted/elevated positions; terrain is a floor.
    state = createExplorerState(data, point, point.facing * Math.PI / 180);
    state.x = point.x; state.y = point.y;
    state.z = Math.max(state.ground, point.z);
    state.eyeHeight = point.mounted ? 2.2 : 1.0;
    if (starting) notify();
    paint();
    if (starting) canvas.focus({ preventScroll: true });
  }
  function selectPlace() {
    if (mode === 'pick') { exit(); return; }
    exit(); mode = 'pick'; notify(); canvas.focus({ preventScroll: true });
  }
  function visible() { return doc.visibilityState !== 'hidden' && container.getClientRects().length && container.clientWidth && (!win.frameElement || win.frameElement.getClientRects().length); }
  function input() {
    return { forward: Number(keys.has('KeyW') || pad.has('forward')) - Number(keys.has('KeyS') || pad.has('back')),
      right: Number(keys.has('KeyD') || pad.has('right')) - Number(keys.has('KeyA') || pad.has('left')),
      jump };
  }
  function tick(time) {
    raf = 0;
    if (mode !== 'explore' || following || disposed || !visible()) { pause(); return; }
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 1 / 60; lastTime = time;
    const turnX = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    const turnY = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
    state = turnExplorer(state, turnX * dt * 1.5, turnY * dt);
    const command = input(); state = stepExplorer(data, state, command, dt); jump = false; paint();
    if (command.forward || command.right || turnX || turnY || state.airborne) raf = win.requestAnimationFrame(tick); else lastTime = 0;
  }
  function wake() { if (!raf && mode === 'explore') raf = win.requestAnimationFrame(tick); }
  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function keyDown(event) {
    if (mode === 'orbit' || doc.activeElement !== canvas) return;
    if (event.code === 'Escape') { event.stopImmediatePropagation(); exit(); return; }
    // Explorer controls must never invoke the editor's delete/undo shortcuts.
    if (['Delete', 'Backspace', 'KeyX'].includes(event.code) || ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ')) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (['KeyQ', 'KeyE'].includes(event.code) || (mode !== 'explore' && ['KeyA', 'KeyD', 'Space'].includes(event.code))) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (mode !== 'explore' || !movementKeys.has(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (following) return;
    if (event.code === 'Space' && !event.repeat) jump = true;
    keys.add(event.code); wake();
  }
  function pointerDown(event) {
    if (mode === 'orbit') return;
    event.stopImmediatePropagation(); event.preventDefault(); canvas.focus({ preventScroll: true });
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (mode === 'orbit') return;
    event.stopImmediatePropagation();
    if (mode !== 'explore' || following || pointer?.id !== event.pointerId) return;
    state = turnExplorer(state, (event.clientX - pointer.x) * .003, -(event.clientY - pointer.y) * .003);
    pointer.x = event.clientX; pointer.y = event.clientY; paint();
  }
  function pointerUp(event) {
    if (mode === 'orbit') return;
    event.stopImmediatePropagation();
    const previous = pointer; pointer = null;
    if (mode !== 'pick' || previous?.id !== event.pointerId || event.type === 'pointercancel' || Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 5) return;
    const hit = api.pick(event.clientX, event.clientY)[0]?.point;
    if (hit) enter(hit, Math.atan2((data.xs[0] + data.xs.at(-1)) / 2 - hit.x, (data.ys[0] + data.ys.at(-1)) / 2 - hit.y));
  }
  listen(canvas, 'pointerdown', pointerDown, true); listen(canvas, 'pointermove', pointerMove, true);
  listen(canvas, 'pointerup', pointerUp, true); listen(canvas, 'pointercancel', pointerUp, true);
  listen(canvas, 'click', event => { if (mode !== 'orbit') event.stopImmediatePropagation(); }, true);
  listen(canvas, 'dblclick', event => { if (mode !== 'orbit') event.stopImmediatePropagation(); }, true);
  listen(doc, 'keydown', keyDown, true); listen(doc, 'keyup', event => keys.delete(event.code), true);
  listen(win, 'blur', pause); listen(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') pause(); });
  listen(canvas, 'blur', () => { keys.clear(); pad.clear(); });
  listen($('explore'), 'click', () => enter());
  listen($('pick'), 'click', selectPlace); listen($('exit'), 'click', exit);
  listen(mini, 'pointerdown', event => {
    if (mode !== 'explore' || following || event.button !== 0) return;
    const rect = mini.getBoundingClientRect(), eyeHeight = state.eyeHeight, pitch = state.pitch;
    const point = { x: data.xs[0] + (event.clientX - rect.left) / rect.width * (data.xs.at(-1) - data.xs[0]),
      y: data.ys.at(-1) - (event.clientY - rect.top) / rect.height * (data.ys.at(-1) - data.ys[0]) };
    enter(point, state.yaw); state.eyeHeight = eyeHeight; state.pitch = pitch; paint(); event.preventDefault();
  });
  for (const button of ui.querySelectorAll('[data-move]')) {
    listen(button, 'pointerdown', event => { event.preventDefault(); canvas.focus({ preventScroll: true }); button.setPointerCapture(event.pointerId); pad.add(button.dataset.move); wake(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(button, type, () => pad.delete(button.dataset.move));
  }
  for (const name of ['surface', 'palette', 'sun', 'haze', 'shadows', 'fog']) listen($(name), name === 'sun' ? 'input' : 'change', () => {
    $('palette').disabled = $('surface').value !== 'elevation';
    api.graphics({ fog: $('fog').value, palette: $('palette').value, surface: $('surface').value, sun: Number($('sun').value), haze: $('haze').checked, shadows: $('shadows').checked });
    container.dispatchEvent(new win.CustomEvent('terrain-graphics-change', { detail: { surface: $('surface').value, palette: $('palette').value } }));
  });
  return { get mode() { return mode; }, get following() { return following; }, enter, follow, exit, pause, refresh: map,
    dispose() { exit(); disposed = true; pause(); for (const remove of listeners) remove(); ui.remove(); },
  };
}
