import { MAX_BYTES, parseBundle, movementHeatmap, sourceEqual } from './tactical-replay.js';
import './replay.css';

export function setupReplay(panel, refresh) {
  const root = document.createElement('section'); root.className = 'replay-controls';
  root.setAttribute('aria-label', 'Tactical replay');
  root.innerHTML = `<div class="replay-toolbar"><label>Open round recordings <input type="file" accept=".json" multiple data-replay="files"></label><label>Recording <select data-replay="selection"><option value="">Select a recording</option></select></label><button data-replay="clear">Clear recordings</button></div>
    <div data-replay="transport" hidden><div class="replay-toolbar"><button data-replay="play">Play</button><label>Speed <select data-replay="speed"><option>1</option><option>5</option><option selected>10</option><option>30</option><option>60</option></select>×</label><label><input type="checkbox" data-replay="players" checked>Players</label><label><input type="checkbox" data-replay="bots" checked>Bots</label><label><input type="checkbox" data-replay="heat">Movement heatmap</label><button data-replay="export">Export heatmap JSON</button></div><input data-replay="timeline" aria-label="Replay timeline" type="range" step="100"><output data-replay="time"></output><p>Blue: Team 1 · Red: Team 2 · Yellow: other teams · White ring: player-controlled · Long arrow: mounted. Paths between samples are approximations; gaps are hidden.</p></div><p data-replay="status" role="status">Select an available replay above, or open exported .replay.json files locally. Local files stay in your browser. Heatmaps combine loaded rounds of the exact same terrain version.</p>`;
  panel.append(root);
  const el = name => root.querySelector(`[data-replay="${name}"]`);
  let loaded = [], selected, layer, viewer, frame, playing = false, t = 0, previousFrame, attached = 0, inputGeneration = 0, heatResult, totalBytes = 0;
  const options = () => ({ players: el('players').checked, bots: el('bots').checked });
  const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  function stop() { playing = false; cancelAnimationFrame(frame); frame = null; previousFrame = undefined; el('play').textContent = 'Play'; }
  function detach() { attached++; stop(); layer?.dispose(); layer = viewer = null; }
  function update() {
    if (!selected) return;
    const r = selected.replay, count = layer?.update({ t, ...options(), heatmap: el('heat').checked });
    el('timeline').value = String(t);
    el('time').textContent = `Round ${time(t - r.header.round_start_ms)} · Coverage ${time(r.first - r.header.round_start_ms)}–${time(r.coverageEnd - r.header.round_start_ms)} · ${count ?? 0} visible · ${r.header.sample_interval_ms / 1000}s samples${r.incomplete ? ' · INCOMPLETE' : ` · ${r.end.reason}`}${r.header.synthetic ? ' · SYNTHETIC' : ''}`;
  }
  function heatmap() {
    if (!selected) return;
    heatResult = movementHeatmap(loaded.filter(x => sourceEqual(x.data.source, selected.data.source) && x.replay.header.synthetic === selected.replay.header.synthetic).map(x => x.replay), selected.data, options());
    layer?.setHeatmap(heatResult);
    el('status').textContent = `${heatResult.recordings.length} matching recording(s) · ${(heatResult.soldier_seconds / 60).toFixed(1)} soldier-minutes · 10 m cells. Only intervals with two samples count; large gaps and unrecorded time are excluded. ${selected.replay.header.synthetic ? 'Synthetic demonstration, not real battle data.' : ''}`;
  }
  function choose(index) {
    stop(); selected = loaded[index]; heatResult = null;
    el('transport').hidden = !selected;
    el('play').disabled = true;
    if (selected) { t = selected.replay.first; el('timeline').min = String(t); el('timeline').max = String(selected.replay.coverageEnd); update(); }
    refresh();
  }
  el('files').addEventListener('change', async event => {
    const token = ++inputGeneration;
    try {
      const files = [...event.target.files];
      if (loaded.length + files.length > 20 || files.reduce((sum, f) => sum + f.size, totalBytes) > MAX_BYTES + 12 * 1024 * 1024) throw new Error('Import limit: 20 files and 76 MiB total. Clear recordings first.');
      const next = [];
      for (const file of files) { const value = await parseBundle(await file.text()); next.push({ ...value, bytes: file.size }); }
      if (token !== inputGeneration) return;
      for (const value of next) {
        if (loaded.some(x => x.replay.header.id === value.replay.header.id)) continue;
        loaded.push(value); totalBytes += value.bytes;
        const option = document.createElement('option'); option.value = String(loaded.length - 1);
        option.textContent = `${value.replay.header.synthetic ? '[SYNTHETIC] ' : ''}${value.replay.header.id}${value.replay.incomplete ? ' (incomplete)' : ''}`;
        el('selection').append(option);
      }
      if (loaded.length) { el('selection').value = String(loaded.length - 1); choose(loaded.length - 1); }
    } catch (error) { el('status').textContent = `Replay could not load: ${error.message}`; }
    event.target.value = '';
  });
  el('selection').addEventListener('change', event => choose(event.target.value === '' ? -1 : Number(event.target.value)));
  el('clear').addEventListener('click', () => { inputGeneration++; loaded = []; totalBytes = 0; el('selection').replaceChildren(new Option('Select a recording', '')); choose(-1); el('status').textContent = 'Recordings cleared.'; });
  el('timeline').addEventListener('input', event => { stop(); t = Number(event.target.value); update(); });
  function tick(now) {
    if (!playing || !selected || !layer) return;
    if (previousFrame !== undefined) t = Math.min(selected.replay.coverageEnd, t + Math.min(250, now - previousFrame) * Number(el('speed').value));
    previousFrame = now; update();
    if (t >= selected.replay.coverageEnd) stop(); else frame = requestAnimationFrame(tick);
  }
  el('play').addEventListener('click', () => {
    if (playing) { stop(); return; } if (!layer) return;
    if (t >= selected.replay.coverageEnd) t = selected.replay.first;
    playing = true; el('play').textContent = 'Pause'; frame = requestAnimationFrame(tick);
  });
  for (const key of ['players', 'bots', 'heat']) el(key).addEventListener('change', () => {
    try { if (el('heat').checked) heatmap(); update(); } catch (error) { el('status').textContent = error.message; }
  });
  el('export').addEventListener('click', () => {
    try {
      heatmap(); const url = URL.createObjectURL(new Blob([JSON.stringify(heatResult)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'movement-heatmap.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { el('status').textContent = error.message; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  return { detach, async open(recording) {
    const token = ++inputGeneration;
    el('status').textContent = 'Loading recording and matching 3D map…';
    try {
      const response = await fetch(import.meta.env.BASE_URL + recording.url);
      if (!response.ok) throw new Error('Recording file could not load');
      const content = await response.text();
      const value = await parseBundle(content);
      if (token !== inputGeneration) return;
      let index = loaded.findIndex(item => item.replay.header.id === value.replay.header.id);
      if (index < 0) {
        const bytes = new TextEncoder().encode(content).length;
        if (loaded.length >= 20 || totalBytes + bytes > MAX_BYTES + 12 * 1024 * 1024) throw new Error('Import limit: 20 files and 76 MiB total. Clear recordings first.');
        index = loaded.length; loaded.push({ ...value, bytes }); totalBytes += bytes;
        el('selection').append(new Option(`${value.replay.header.synthetic ? '[SYNTHETIC] ' : ''}${value.replay.header.id}${value.replay.incomplete ? ' (incomplete)' : ''}`, String(index)));
      }
      el('selection').value = String(index); choose(index);
    } catch (error) { if (token === inputGeneration) el('status').textContent = `Replay could not load: ${error.message}`; }
  }, terrain: () => selected?.data, async attach(nextViewer) {
    if (!selected) return;
    const token = ++attached, { createReplayLayer } = await import('./replay-layer.js');
    if (token !== attached) return;
    viewer = nextViewer; layer = createReplayLayer(viewer, selected.data, selected.replay); el('play').disabled = false; update();
    try { heatmap(); } catch (error) { el('status').textContent = error.message; }
  } };
}
