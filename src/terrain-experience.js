import { elevationPalettes } from './terrain-palettes.js';
import { createExplorerState, switchExplorerMode, stepExplorer, turnExplorer, EXPLORER_PROFILES, clamp } from './terrain-explorer-motion.js';

export function createTerrainExperience(container, data, api, styles = '') {
  const doc = container.ownerDocument, win = doc.defaultView, canvas = api.canvas;
  if (!doc.querySelector('style[data-terrain-experience]')) {
    const style = doc.createElement('style'); style.dataset.terrainExperience = ''; style.textContent = styles; doc.head.append(style);
  }
  const ui = doc.createElement('div'); ui.className = 'terrain-experience';
  ui.innerHTML = `<div class="terrain-tools">
    <details class="terrain-graphics"><summary>Lighting & haze</summary>
      <label>Surface <select data-ui="surface"><option value="elevation">Elevation</option><option value="natural">Natural</option></select></label>
      <label>Elevation palette <select data-ui="palette">${Object.entries(elevationPalettes).map(([value, palette]) => `<option value="${value}">${palette.label}</option>`).join('')}</select></label>
      <label>Sun direction <input data-ui="sun" type="range" min="0" max="360" value="135" aria-label="Sun direction in degrees"></label>
      <label>Distance haze <input data-ui="haze" type="checkbox" checked></label>
      <label>Shadows <input data-ui="shadows" type="checkbox" checked></label>
    </details>
    <div class="terrain-experience-actions" role="group" aria-label="Explore the map">
      <button data-ui="infantry" aria-pressed="false">Infantry</button><button data-ui="mounted" aria-pressed="false">Mounted</button>
      <button data-ui="pick" aria-pressed="false">Stand here</button><button data-ui="exit" hidden>Exit explorer</button>
    </div></div>
    <div class="terrain-pick-note" data-ui="pick-note" hidden>Click the terrain to stand there.<br>Escape cancels.</div>
    <div class="terrain-crosshair" data-ui="crosshair" hidden aria-hidden="true"></div>
    <div class="terrain-minimap" data-ui="minimap-wrap" hidden><canvas data-ui="minimap" width="320" height="320" tabindex="0" role="img" aria-label="Explorer overview. Click to move here; orange arrow shows your position and facing."></canvas><p>↑ +Y · blue/red: teams · orange: you<br>Click to relocate</p></div>
    <div class="terrain-hud" data-ui="hud" hidden>
      <strong data-ui="readout"></strong><p data-ui="position"></p>
      <div class="terrain-hud-row"><button data-ui="lock">Mouse look</button><button data-ui="team1">Team 1</button><button data-ui="team2">Team 2</button>
      <label>Eye m <input data-ui="eye" type="number" min=".8" max="4" step=".1" value="1.7" aria-label="Preview eye height in metres"></label></div>
      <p>WASD move · Shift run/gallop · drag to look · Space hop</p>
      <p data-ui="message" role="status">Esc releases the mouse; Exit returns to the overview.</p>
      <p class="terrain-extra-help">Preview heights/speeds · true terrain scale · no obstacle collisions.</p>
    </div>
    <div class="terrain-move-pad" data-ui="pad" role="group" aria-label="Move explorer" hidden>
      <button data-move="forward" aria-label="Move forward">↑</button><button data-move="left" aria-label="Move left">←</button><button data-move="back" aria-label="Move backward">↓</button><button data-move="right" aria-label="Move right">→</button>
    </div>`;
  container.append(ui);
  const $ = name => ui.querySelector(`[data-ui="${name}"]`), mini = $('minimap'), ctx = mini.getContext('2d');
  let mode = 'orbit', profile = 'infantry', state = null, disposed = false, raf = 0, lastTime = 0, pointer = null, jump = false;
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
    $('readout').textContent = `${EXPLORER_PROFILES[state.mode].label} · ${state.eyeHeight.toFixed(1)} m eyes · ${state.speed.toFixed(1)} m/s`;
    $('position').textContent = `X ${state.x.toFixed(1)} · Y ${state.y.toFixed(1)} · ground ${state.ground.toFixed(1)} m`;
  }
  function notify() {
    const exploring = mode === 'explore';
    for (const name of ['hud', 'crosshair', 'minimap-wrap', 'pad']) $(name).hidden = !exploring;
    $('exit').hidden = mode === 'orbit'; $('pick-note').hidden = mode !== 'pick';
    $('pick').setAttribute('aria-pressed', mode === 'pick');
    for (const name of ['infantry', 'mounted']) $(name).setAttribute('aria-pressed', exploring && state.mode === name);
    canvas.style.cursor = mode === 'pick' ? 'crosshair' : exploring ? 'crosshair' : '';
    api.modeChanged(mode);
    container.dispatchEvent(new win.CustomEvent('terrain-modechange', { detail: { mode, profile } }));
  }
  function unlock() { if (doc.pointerLockElement === canvas) doc.exitPointerLock?.(); }
  function pause() { keys.clear(); pad.clear(); jump = false; pointer = null; win.cancelAnimationFrame(raf); raf = 0; lastTime = 0; if (state) state.speed = 0; unlock(); }
  function exit() {
    if (mode === 'orbit') return;
    const wasExploring = mode === 'explore'; pause(); mode = 'orbit';
    if (wasExploring) api.end(); notify();
  }
  function spawnPoint(index = 0) {
    const spawns = api.spawns(), p = spawns[index], q = spawns[1 - index];
    return { point: { x: p.x_m, y: p.y_m }, yaw: Math.atan2(q.x_m - p.x_m, q.y_m - p.y_m) };
  }
  function enter(nextProfile, point, yaw) {
    profile = nextProfile;
    if (mode === 'explore' && !point) state = switchExplorerMode(state, profile);
    else {
      if (mode !== 'explore') api.begin();
      const start = point ? { point, yaw: yaw ?? state?.yaw ?? 0 } : state ? { point: state, yaw: state.yaw } : spawnPoint();
      state = createExplorerState(data, profile, start.point, start.yaw);
    }
    mode = 'explore'; $('eye').value = state.eyeHeight;
    $('message').textContent = 'Esc releases the mouse; Exit returns to the overview.';
    notify(); paint(); canvas.focus({ preventScroll: true });
  }
  function selectPlace() {
    if (mode === 'pick') { exit(); return; }
    exit(); mode = 'pick'; notify(); canvas.focus({ preventScroll: true });
  }
  function visible() { return doc.visibilityState !== 'hidden' && container.getClientRects().length && container.clientWidth && (!win.frameElement || win.frameElement.getClientRects().length); }
  function input() {
    return { forward: Number(keys.has('KeyW') || pad.has('forward')) - Number(keys.has('KeyS') || pad.has('back')),
      right: Number(keys.has('KeyD') || pad.has('right')) - Number(keys.has('KeyA') || pad.has('left')),
      run: keys.has('ShiftLeft') || keys.has('ShiftRight'), jump };
  }
  function tick(time) {
    raf = 0;
    if (mode !== 'explore' || disposed || !visible()) { pause(); return; }
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 1 / 60; lastTime = time;
    const turnX = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    const turnY = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
    state = turnExplorer(state, turnX * dt * 1.5, turnY * dt);
    const command = input(); state = stepExplorer(data, state, command, dt); jump = false; paint();
    if (command.forward || command.right || turnX || turnY || state.airborne) raf = win.requestAnimationFrame(tick); else lastTime = 0;
  }
  function wake() { if (!raf && mode === 'explore') raf = win.requestAnimationFrame(tick); }
  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function keyDown(event) {
    if (mode === 'orbit' || (doc.activeElement !== canvas && doc.pointerLockElement !== canvas)) return;
    if (event.code === 'Escape') { event.stopImmediatePropagation(); if (doc.pointerLockElement === canvas) pause(); else exit(); return; }
    // Explorer controls must never invoke the editor's delete/undo shortcuts.
    if (['Delete', 'Backspace', 'KeyX'].includes(event.code) || ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ')) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (['KeyQ', 'KeyE'].includes(event.code) || (mode !== 'explore' && ['KeyA', 'KeyD', 'Space'].includes(event.code))) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (mode !== 'explore' || !movementKeys.has(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
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
    if (mode !== 'explore' || doc.pointerLockElement === canvas || pointer?.id !== event.pointerId) return;
    state = turnExplorer(state, (event.clientX - pointer.x) * .003, -(event.clientY - pointer.y) * .003);
    pointer.x = event.clientX; pointer.y = event.clientY; paint();
  }
  function pointerUp(event) {
    if (mode === 'orbit') return;
    event.stopImmediatePropagation();
    const previous = pointer; pointer = null;
    if (mode !== 'pick' || previous?.id !== event.pointerId || event.type === 'pointercancel' || Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 5) return;
    const hit = api.pick(event.clientX, event.clientY)[0]?.point;
    if (hit) enter(profile, hit, Math.atan2((data.xs[0] + data.xs.at(-1)) / 2 - hit.x, (data.ys[0] + data.ys.at(-1)) / 2 - hit.y));
  }
  listen(canvas, 'pointerdown', pointerDown, true); listen(canvas, 'pointermove', pointerMove, true);
  listen(canvas, 'pointerup', pointerUp, true); listen(canvas, 'pointercancel', pointerUp, true);
  listen(canvas, 'click', event => { if (mode !== 'orbit') event.stopImmediatePropagation(); }, true);
  listen(canvas, 'dblclick', event => { if (mode !== 'orbit') event.stopImmediatePropagation(); }, true);
  listen(doc, 'keydown', keyDown, true); listen(doc, 'keyup', event => keys.delete(event.code), true);
  listen(doc, 'mousemove', event => {
    if (mode === 'explore' && doc.pointerLockElement === canvas) { state = turnExplorer(state, event.movementX * .002, -event.movementY * .002); paint(); }
  });
  listen(doc, 'pointerlockchange', () => {
    keys.clear(); pad.clear(); jump = false;
    if (mode !== 'explore') return;
    $('message').textContent = doc.pointerLockElement === canvas ? 'Mouse captured. Press Esc to release it.' : 'Mouse released. Drag to look, or click Mouse look.';
  });
  listen(doc, 'pointerlockerror', () => { $('message').textContent = 'Mouse capture is unavailable. Drag to look; WASD still works.'; });
  listen(win, 'blur', pause); listen(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') pause(); });
  listen(canvas, 'blur', () => { keys.clear(); pad.clear(); });
  listen($('infantry'), 'click', () => enter('infantry')); listen($('mounted'), 'click', () => enter('mounted'));
  listen($('pick'), 'click', selectPlace); listen($('exit'), 'click', exit);
  listen($('lock'), 'click', async () => {
    canvas.focus({ preventScroll: true });
    try { if (!canvas.requestPointerLock) throw new Error('Unavailable'); await canvas.requestPointerLock(); }
    catch { if (!disposed) $('message').textContent = 'Mouse capture is unavailable. Drag to look; WASD still works.'; }
  });
  for (const index of [0, 1]) listen($(`team${index + 1}`), 'click', () => { const start = spawnPoint(index); enter(profile, start.point, start.yaw); });
  listen($('eye'), 'change', () => {
    const value = Number($('eye').value); if (state && Number.isFinite(value)) state.eyeHeight = clamp(value, .8, 4);
    $('eye').value = state.eyeHeight; paint();
  });
  listen(mini, 'pointerdown', event => {
    if (mode !== 'explore' || event.button !== 0) return;
    const rect = mini.getBoundingClientRect(), eyeHeight = state.eyeHeight, pitch = state.pitch;
    const point = { x: data.xs[0] + (event.clientX - rect.left) / rect.width * (data.xs.at(-1) - data.xs[0]),
      y: data.ys.at(-1) - (event.clientY - rect.top) / rect.height * (data.ys.at(-1) - data.ys[0]) };
    enter(profile, point, state.yaw); state.eyeHeight = eyeHeight; state.pitch = pitch; $('eye').value = eyeHeight; paint(); event.preventDefault();
  });
  for (const button of ui.querySelectorAll('[data-move]')) {
    listen(button, 'pointerdown', event => { event.preventDefault(); canvas.focus({ preventScroll: true }); button.setPointerCapture(event.pointerId); pad.add(button.dataset.move); wake(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(button, type, () => pad.delete(button.dataset.move));
  }
  for (const name of ['surface', 'palette', 'sun', 'haze', 'shadows']) listen($(name), name === 'sun' ? 'input' : 'change', () => {
    $('palette').disabled = $('surface').value !== 'elevation';
    api.graphics({ palette: $('palette').value, surface: $('surface').value, sun: Number($('sun').value), haze: $('haze').checked, shadows: $('shadows').checked });
    container.dispatchEvent(new win.CustomEvent('terrain-graphics-change', { detail: { surface: $('surface').value, palette: $('palette').value } }));
  });
  return { get mode() { return mode; }, enter, exit, pause, refresh: map,
    dispose() { exit(); disposed = true; pause(); for (const remove of listeners) remove(); ui.remove(); },
  };
}
