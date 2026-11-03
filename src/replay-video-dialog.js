import { createVideoRenderer } from './replay-video-renderer.js';
import { checkMp4Support, encodeMp4 } from './replay-video-encoder.js';
import { videoSchedule, videoSize, videoClock, videoReplayModel, isExperimentalVideo } from './replay-video-model.js';
import { createCinematicControls } from './replay-cinematic-controls.js';

export function openVideoExport(snapshot) {
  const dialog = document.createElement('dialog'); dialog.className = 'replay-video-dialog';
  dialog.setAttribute('aria-labelledby', 'replay-video-title');
  dialog.innerHTML = `<div class="replay-video-heading"><div><h2 id="replay-video-title">Export replay MP4</h2><p>Map, live army stats, and your selected overlays. Silent video · 30 fps.</p></div><button type="button" data-video="close" aria-label="Close MP4 export">Close</button></div>
    <fieldset class="replay-video-options"><legend>Video settings</legend>
      <label>Camera<select data-video="camera"><option value="current">Current view</option><option value="overhead">Full-map overhead</option></select></label>
      <label>Layout<select data-video="layout"><option value="landscape">16:9 · Landscape</option><option value="portrait">9:16 · Portrait</option></select></label>
      <label>Resolution<select data-video="resolution"><option value="1080">1080p</option><option value="720">720p</option></select></label>
      <label>Start (round seconds)<input data-video="start" type="number" step="0.001" required></label>
      <label>End (round seconds)<input data-video="end" type="number" step="0.001" required></label>
      <label>Speed<select data-video="speed"><option>1</option><option>5</option><option>10</option><option>30</option><option>60</option></select>×</label>
    </fieldset>
    <p data-video="layout-note" hidden>Portrait fits the 3D view above the bots-alive plot. Future chart data stays hidden. Blank margins reserve 10% at the top and bottom and 6% at the sides for future branding.</p>
    <p data-video="duration"></p><div class="replay-video-preview" data-video="preview"></div>
    <label class="replay-video-scrub">Preview time<output data-video="time"></output><input data-video="timeline" type="range" step="0.001" aria-label="Video preview time"></label>
    <p data-video="compatibility" role="status"></p>
    <div class="replay-video-actions"><button type="button" data-video="save" disabled>Save MP4…</button><button type="button" data-video="cancel" hidden>Cancel export</button><progress data-video="progress" max="1" value="0" aria-label="MP4 export progress" hidden></progress></div>
    <p data-video="status" role="status" aria-live="polite">Preparing preview…</p>`;
  document.body.append(dialog); dialog.showModal();
  const el = key => dialog.querySelector(`[data-video="${key}"]`);
  el('camera').append(new Option('Cinematic camera', 'cinematic'));
  el('camera').value = snapshot.cameraMode || 'current';
  // Rebuild on change below; input events only update the slider readout.
  const cinematicControls = createCinematicControls(dialog, undefined, snapshot.cinematic);
  dialog.querySelector('.replay-video-options').after(cinematicControls.element);
  cinematicControls.element.querySelector('p').textContent = 'Follows opposing forces and recent casualties across the whole battle. Scrub the preview to inspect the camera path.';
  cinematicControls.element.hidden = el('camera').value !== 'cinematic';
  const replay = videoReplayModel(snapshot.replay), origin = replay.header.round_start_ms;
  if (isExperimentalVideo(snapshot.replay)) {
    for (const key of ['start', 'end']) el(key).parentElement.firstChild.textContent = `${key === 'start' ? 'Start' : 'End'} (capture seconds)`;
  }
  const first = (replay.first - origin) / 1000, last = (replay.coverageEnd - origin) / 1000;
  for (const key of ['start', 'end']) { el(key).min = String(first); el(key).max = String(last); }
  el('start').value = String((snapshot.t - origin) / 1000);
  el('end').value = String((snapshot.clipEnd - origin) / 1000);
  if (Number.isFinite(snapshot.speed) && snapshot.speed > 0 && ![...el('speed').options].some(option => Number(option.value) === snapshot.speed)) {
    el('speed').append(new Option(String(snapshot.speed), String(snapshot.speed)));
  }
  el('speed').value = String(snapshot.speed);
  let renderer, schedule, settings, controller, disposed = false, generation = 0, busy = false, unsupported = true, graphicsError = '';
  const options = () => ({ ...snapshot, ...videoSize(el('resolution').value, el('layout').value), cameraMode: el('camera').value, cinematic: cinematicControls.value(), speed: Number(el('speed').value) });
  function status(message) { if (!disposed) el('status').textContent = message; }
  function graphicsLost(message) {
    graphicsError = message; controller?.abort(new Error(message));
    el('save').disabled = true; status(`Export graphics were interrupted: ${message} Close and reopen the export to retry.`);
  }
  function preview() {
    if (disposed || !renderer?.loaded || !schedule || graphicsError) return;
    try {
      const t = origin + Number(el('timeline').value) * 1000;
      renderer.render(t); el('time').textContent = videoClock(t - origin);
    } catch (error) { graphicsLost(error.message); }
  }
  async function update() {
    cinematicControls.element.hidden = el('camera').value !== 'cinematic';
    el('preview').classList.toggle('is-portrait', el('layout').value === 'portrait');
    el('layout-note').hidden = el('layout').value !== 'portrait';
    const token = ++generation;
    el('save').disabled = true; schedule = null;
    try {
      schedule = videoSchedule(replay, { start: el('start').value === '' ? NaN : Number(el('start').value),
        end: el('end').value === '' ? NaN : Number(el('end').value), speed: Number(el('speed').value) });
      el('duration').textContent = `Video duration: ${schedule.duration.toFixed(2)} seconds · ${schedule.frames} frames`;
      el('timeline').min = el('start').value; el('timeline').max = el('end').value;
      el('timeline').value = el('start').value;
      const next = options();
      if (!settings || settings.width !== next.width || settings.height !== next.height || settings.cameraMode !== next.cameraMode || settings.speed !== next.speed || JSON.stringify(settings.cinematic) !== JSON.stringify(next.cinematic)) {
        renderer?.dispose(); renderer = null; graphicsError = '';
        renderer = createVideoRenderer(next, graphicsLost); settings = next;
        el('preview').replaceChildren(renderer.canvas);
      }
      status('Loading map assets…');
      await renderer.ready;
      if (disposed || token !== generation) return;
      preview();
      el('compatibility').textContent = 'Checking MP4 support…';
      const reason = await checkMp4Support(next);
      if (disposed || token !== generation) return;
      unsupported = !!reason;
      el('compatibility').textContent = reason || 'MP4 ready · choose a destination when saving. Settings and overlays were captured when you opened this preview.';
      el('save').disabled = unsupported || !!graphicsError || busy;
      if (!graphicsError) status('Scrub the preview to check the clip before saving.');
    } catch (error) {
      if (disposed || token !== generation) return;
      schedule = null;
      if (renderer && !renderer.loaded) { renderer.dispose(); renderer = null; settings = null; }
      el('duration').textContent = ''; el('compatibility').textContent = ''; status(error.message);
    }
  }
  function setBusy(value) {
    busy = value;
    for (const fieldset of dialog.querySelectorAll('fieldset')) fieldset.disabled = value;
    el('timeline').disabled = value;
    el('save').disabled = value || unsupported || !schedule || !!graphicsError;
    el('cancel').hidden = el('progress').hidden = !value;
  }
  async function save() {
    if (busy || !schedule || unsupported || graphicsError) return;
    const active = new AbortController(); controller = active;
    const currentSchedule = schedule, currentRenderer = renderer;
    setBusy(true); el('progress').value = 0;
    try {
      // Call before awaiting anything to retain the click's user activation.
      const name = `${replay.header.id}-${el('start').value}-${el('end').value}.mp4`.replace(/[^a-zA-Z0-9._-]/g, '_');
      const file = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      active.signal.throwIfAborted(); status('Rendering MP4… 0%');
      let previousPercent = -1;
      await encodeMp4({ canvas: currentRenderer.canvas, schedule: currentSchedule, render: t => currentRenderer.render(t), file, signal: active.signal,
        onProgress(fraction) {
          if (disposed) return;
          const percent = Math.floor(fraction * 100);
          if (percent !== previousPercent) { el('progress').value = fraction; status(percent === 100 ? 'Finalizing MP4…' : `Rendering MP4… ${percent}%`); previousPercent = percent; }
        } });
      status('MP4 saved.');
    } catch (error) {
      status(graphicsError ? `Export graphics were interrupted: ${graphicsError}` : error.name === 'AbortError' ? 'Export canceled. No video was saved.' : `MP4 could not save: ${error.message}`);
    } finally {
      if (!disposed) { setBusy(false); preview(); }
      if (controller === active) controller = null;
    }
  }
  function close() {
    if (disposed) return;
    disposed = true; generation++; controller?.abort(); renderer?.dispose();
    dialog.close(); dialog.remove();
  }
  for (const input of dialog.querySelectorAll('fieldset input, fieldset select')) input.addEventListener('change', update);
  el('timeline').addEventListener('input', preview);
  el('save').addEventListener('click', save);
  el('close').addEventListener('click', close);
  el('cancel').addEventListener('click', () => controller?.abort());
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (busy) controller?.abort(); else close(); });
  update();
  return close;
}
