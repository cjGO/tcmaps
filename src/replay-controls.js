import { MAX_BYTES, parseBundle, movementHeatmap, sourceEqual, soldierViewAt } from './tactical-replay.js';
import { squadKey } from './replay-history.js';
import { createBotStrengthChart } from './replay-strength.js';
import { replayLink, replayWindow } from './replay-link.js';
import './replay.css';

export function setupReplay(panel, refresh) {
  const root = document.createElement('section'); root.className = 'replay-controls';
  root.setAttribute('aria-label', 'Tactical replay');
  root.innerHTML = `<div class="replay-toolbar"><label>Open round recordings <input type="file" accept=".json" multiple data-replay="files"></label><label>Recording <select data-replay="selection"><option value="">Select a recording</option></select></label><button data-replay="clear">Clear recordings</button></div>
    <div data-replay="transport" hidden><div class="replay-toolbar"><button class="replay-play" data-replay="play" aria-pressed="false">▶ Play</button><label>Speed <select data-replay="speed"><option>1</option><option>5</option><option selected>10</option><option>30</option><option>60</option></select>×</label><label><input type="checkbox" data-replay="players" checked>Players</label><label><input type="checkbox" data-replay="bots" checked>Bots</label><label><input type="checkbox" data-replay="player-names" checked>Player names</label><label><input type="checkbox" data-replay="heat">Movement heatmap so far</label><label><input type="checkbox" data-replay="trails">Trails so far</label><label>Trail transparency <input type="range" data-replay="trail-transparency" min="0" max="100" step="1" value="75"><output data-replay="trail-transparency-value">75%</output></label><label><input type="checkbox" data-replay="deaths" checked>Bot deaths</label><label>Bot death transparency <input type="range" data-replay="death-transparency" min="0" max="100" step="1" value="75"><output data-replay="death-transparency-value">75%</output></label><label>Squad <select data-replay="squad"><option value="">All squads</option></select></label><label>Soldier <select data-replay="soldier"><option value="">All soldiers</option></select></label><label>Follow soldier <select data-replay="follow"><option value="">Free camera</option></select></label><output data-replay="follow-status" role="status"></output><button data-replay="export">Export all loaded rounds heatmap JSON</button></div><div class="replay-strength" data-replay="strength"></div><input data-replay="timeline" aria-label="Replay timeline" type="range" step="100"><output data-replay="time"></output><p>Blue: Team 1 · Red: Team 2 · Yellow: other teams · Square: infantry · Circle: artillery · Triangle: cavalry · White ring: player-controlled. Player names use recorded names, or player IDs when unavailable. X: bot death at last recorded position (approximate). Death markers persist after the death time. Paths between samples are approximations; gaps are hidden.</p></div><p data-replay="status" role="status">Select an available replay above, or open exported .replay.json files locally. Local files stay in your browser. Trails and the heatmap follow the selected recording and timeline. Export combines loaded rounds of the exact same terrain version.</p>`;
  panel.append(root);
  const el = name => root.querySelector(`[data-replay="${name}"]`);
  // Keep the control hooks together while giving each task a clear visual group.
  const transport = el('transport');
  const group = (title, keys) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'replay-group';
    const legend = document.createElement('legend'); legend.textContent = title;
    fieldset.append(legend);
    for (const key of keys) fieldset.append(el(key).closest('label'));
    return fieldset;
  };
  const playback = document.createElement('div'); playback.className = 'replay-playback';
  playback.append(el('play'), el('speed').closest('label'));
  const scrubber = document.createElement('div'); scrubber.className = 'replay-scrubber';
  const timelineLabel = document.createElement('label'); timelineLabel.textContent = 'Round timeline';
  timelineLabel.append(el('timeline'));
  scrubber.append(timelineLabel, el('time')); playback.append(scrubber);
  const sharing = document.createElement('div'); sharing.className = 'replay-sharing';
  sharing.innerHTML = `<button type="button" data-replay="share">Copy link at current time</button><button type="button" data-replay="mp4" disabled>Export MP4</button><label>Clip end (round seconds, optional)<input data-replay="clip-end" type="number" min="0" step="any" placeholder="Play to round end"></label><label data-replay="share-link-label" hidden>Replay link<input data-replay="share-link" type="text" readonly></label><p data-replay="share-status" role="status"></p>`;
  const groups = document.createElement('div'); groups.className = 'replay-option-grid';
  const display = group('Map display', ['players', 'bots', 'player-names', 'heat']);
  for (const [toggle, slider] of [['trails', 'trail-transparency'], ['deaths', 'death-transparency']]) {
    const row = document.createElement('div'); row.className = 'replay-overlay';
    row.append(el(toggle).closest('label'), el(slider).closest('label')); display.append(row);
  }
  const filters = group('Soldier filters & camera', ['squad', 'soldier', 'follow']);
  filters.append(el('follow-status'));
  groups.append(display, filters);
  const exportRow = document.createElement('div'); exportRow.className = 'replay-export';
  const exportNote = document.createElement('p'); exportNote.textContent = 'Combine all loaded rounds of the same terrain version, using the player and bot filters.';
  el('export').textContent = 'Export heatmap JSON'; exportRow.append(exportNote, el('export'));
  const guide = document.createElement('details'); guide.className = 'replay-guide';
  const summary = document.createElement('summary'); summary.textContent = 'Map legend & recording details';
  guide.append(summary, transport.querySelector('p'));
  transport.querySelector('.replay-toolbar').remove();
  transport.prepend(playback, sharing, groups);
  transport.append(exportRow, guide);
  let loaded = [], selected, layer, viewer, frame, playing = false, t = 0, previousFrame, attached = 0, inputGeneration = 0, heatResult, totalBytes = 0, unsubscribeFollow, syncingFollow = false, strengthChart;
  let clipStart = 0, clipEnd = 0, closeVideo;
  const options = () => ({ players: el('players').checked, bots: el('bots').checked, squad: el('squad').value, soldier: el('soldier').value });
  const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  function stop() { playing = false; cancelAnimationFrame(frame); frame = null; previousFrame = undefined; el('play').textContent = '▶ Play'; el('play').setAttribute('aria-pressed', 'false'); }
  function detach() {
    closeVideo?.(); closeVideo = null; el('mp4').disabled = true;
    attached++; stop(); unsubscribeFollow?.(); unsubscribeFollow = null;
    el('follow').disabled = true;
    if (el('follow').value) viewer?.stopFollowing();
    layer?.dispose(); layer = viewer = null;
  }
  function updateFollow() {
    const id = el('follow').value;
    const track = selected.replay.tracks.get(Number(id));
    const pose = id && soldierViewAt(track, t, selected.replay);
    const message = !pose ? 'waiting for first recorded position.' : pose.ended ?
      `${track.removalReason === 'death' ? 'died' : 'removed'}; camera held at last recorded position.` :
      pose.holding ? 'recording gap; camera held.' : 'following recorded position and facing.';
    const status = id ? `Soldier #${id}: ${message}` : '';
    if (el('follow-status').textContent !== status) el('follow-status').textContent = status;
    if (!viewer) return;
    syncingFollow = true;
    try {
      if (pose) viewer.followSoldier(pose);
      else if (id) viewer.stopFollowing();
    } finally { syncingFollow = false; }
  }
  const overlayOptions = () => ({ ...options(), playerNames: el('player-names').checked, heatmap: el('heat').checked, trails: el('trails').checked, trailOpacity: 1 - Number(el('trail-transparency').value) / 100, deaths: el('deaths').checked, deathOpacity: 1 - Number(el('death-transparency').value) / 100, followSoldier: el('follow').value });
  function update() {
    if (!selected) return;
    strengthChart?.update(t);
    updateFollow();
    const r = selected.replay, count = layer?.update({ t, ...overlayOptions() });
    el('timeline').value = String(t);
    el('time').textContent = `Round ${time(t - r.header.round_start_ms)} · Coverage ${time(r.first - r.header.round_start_ms)}–${time(r.coverageEnd - r.header.round_start_ms)} · ${count ?? 0} visible · ${r.header.sample_interval_ms / 1000}s samples${r.incomplete ? ' · INCOMPLETE' : ` · ${r.end.reason}`}${r.header.synthetic ? ' · SYNTHETIC' : ''}`;
  }
  function heatmap() {
    if (!selected) return;
    heatResult = movementHeatmap(loaded.filter(x => sourceEqual(x.data.source, selected.data.source) && x.replay.header.synthetic === selected.replay.header.synthetic).map(x => x.replay), selected.data, options());
    el('status').textContent = `${heatResult.recordings.length} matching recording(s) · ${(heatResult.soldier_seconds / 60).toFixed(1)} soldier-minutes · 10 m cells. Only intervals with two samples count; large gaps and unrecorded time are excluded. ${selected.replay.header.synthetic ? 'Synthetic demonstration, not real battle data.' : ''}`;
  }
  function choose(index, initial = {}) {
    stop(); el('follow').value = ''; viewer?.stopFollowing(); selected = loaded[index]; heatResult = null;
    el('transport').hidden = !selected;
    strengthChart?.dispose(); strengthChart = null; el('strength').replaceChildren();
    if (selected) strengthChart = createBotStrengthChart(el('strength'), selected.replay, next => { stop(); t = next; update(); });
    el('play').disabled = true;
    el('squad').replaceChildren(new Option('All squads', ''));
    el('soldier').replaceChildren(new Option('All soldiers', ''));
    el('follow').replaceChildren(new Option('Free camera', ''));
    el('follow-status').textContent = '';
    el('follow').disabled = true;
    if (selected) {
      const squads = new Map();
      for (const track of selected.replay.tracks.values()) {
        el('soldier').append(new Option(`Soldier #${track.id}`, String(track.id)));
        if (track.samples.length) el('follow').append(new Option(`Soldier #${track.id} · ${track.changes[0].kind}`, String(track.id)));
        for (const meta of track.changes) squads.set(squadKey(meta), `Team ${meta.team + 1} · ${meta.owner === false ? 'Unassigned' : `Commander #${meta.owner}`}`);
      }
      for (const [key, label] of squads) el('squad').append(new Option(label, key));
    }
    el('share').disabled = !selected?.publishedId;
    el('clip-end').disabled = !selected?.publishedId;
    el('clip-end').value = '';
    el('clip-end').setCustomValidity('');
    el('share-link-label').hidden = true;
    el('share-status').textContent = selected && !selected.publishedId ? 'Publish this local recording before sharing a link.' : '';
    if (selected) {
      const window = replayWindow(selected.replay, initial);
      t = clipStart = window.from; clipEnd = window.to;
      if (initial.end !== undefined) el('clip-end').value = String((clipEnd - selected.replay.header.round_start_ms) / 1000);
      if (initial.follow) el('follow').value = initial.follow;
      el('timeline').min = String(selected.replay.first); el('timeline').max = String(selected.replay.coverageEnd); update();
    }
    if (!panel.closest('[role="tabpanel"]').hidden && selected?.publishedId) history.replaceState(null, '', replayLink(location.href, selected.publishedId, initial));
    else if (!panel.closest('[role="tabpanel"]').hidden) {
      const url = new URL(location.href);
      for (const key of ['replay', 't', 'end', 'follow']) url.searchParams.delete(key);
      url.searchParams.set('tab', 'replays');
      history.replaceState(null, '', url);
    }
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
    if (previousFrame !== undefined) t = Math.min(clipEnd, t + Math.min(250, now - previousFrame) * Number(el('speed').value));
    previousFrame = now; update();
    if (t >= clipEnd) stop(); else frame = requestAnimationFrame(tick);
  }
  el('play').addEventListener('click', () => {
    if (playing) { stop(); return; } if (!layer) return;
    if (t >= clipEnd) t = clipStart;
    playing = true; el('play').textContent = 'Ⅱ Pause'; el('play').setAttribute('aria-pressed', 'true'); frame = requestAnimationFrame(tick);
  });
  for (const key of ['players', 'bots', 'player-names', 'heat', 'trails', 'deaths', 'squad', 'soldier']) el(key).addEventListener('change', () => {
    try { update(); } catch (error) { stop(); el('heat').checked = el('trails').checked = false; update(); el('status').textContent = error.message; }
  });
  for (const key of ['trail-transparency', 'death-transparency']) el(key).addEventListener('input', () => {
    el(`${key}-value`).textContent = `${el(key).value}%`;
    update();
  });
  el('follow').addEventListener('change', () => {
    if (!el('follow').value) viewer?.stopFollowing();
    update();
  });
  el('clip-end').addEventListener('input', () => {
    el('clip-end').setCustomValidity('');
    if (!selected) return;
    clipEnd = replayWindow(selected.replay, { t: (t - selected.replay.header.round_start_ms) / 1000,
      end: el('clip-end').value === '' ? undefined : Number(el('clip-end').value) }).to;
  });
  el('share').addEventListener('click', async () => {
    if (!selected?.publishedId) return;
    stop();
    const from = (t - selected.replay.header.round_start_ms) / 1000;
    const end = el('clip-end').value === '' ? undefined : Number(el('clip-end').value);
    if (!el('clip-end').checkValidity() || (end !== undefined && end <= from)) {
      el('clip-end').setCustomValidity('Clip end must be later than the current round time.');
      el('clip-end').reportValidity();
      return;
    }
    const link = replayLink(location.href, selected.publishedId, { t: from, end, follow: el('follow').value });
    el('share-link').value = link; el('share-link-label').hidden = false;
    history.replaceState(null, '', link);
    try {
      await navigator.clipboard.writeText(link);
      el('share-status').textContent = 'Link copied. It opens paused at this time; press Play to watch.';
    } catch {
      el('share-link').focus(); el('share-link').select();
      el('share-status').textContent = 'Copy the selected link with Ctrl+C, ⌘C, or your device’s Copy option.';
    }
  });
  el('export').addEventListener('click', () => {
    try {
      heatmap(); const url = URL.createObjectURL(new Blob([JSON.stringify(heatResult)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'movement-heatmap.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { el('status').textContent = error.message; }
  });
  el('mp4').addEventListener('click', async () => {
    if (!viewer || !selected || !layer) return;
    stop(); viewer.pauseExplorer(); closeVideo?.();
    const token = attached;
    const snapshot = { ...selected, t, clipEnd, speed: Number(el('speed').value), overlays: overlayOptions(),
      view: viewer.captureViewState(), mapLabel: `${selected.replay.header.map.id} · ${selected.replay.header.map.version.slice(0, 10)}` };
    el('mp4').disabled = true;
    try {
      const { openVideoExport } = await import('./replay-video-dialog.js');
      if (token === attached && viewer) closeVideo = openVideoExport(snapshot);
    } catch (error) { el('status').textContent = `MP4 export could not open: ${error.message}`; }
    finally { el('mp4').disabled = !layer; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  return { detach, async open(recording, initial = {}) {
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
      loaded[index].publishedId = recording.id;
      el('selection').value = String(index); choose(index, initial);
    } catch (error) { if (token === inputGeneration) el('status').textContent = `Replay could not load: ${error.message}`; }
  }, terrain: () => selected?.data, async attach(nextViewer) {
    if (!selected) return;
    const token = ++attached, { createReplayLayer } = await import('./replay-layer.js');
    if (token !== attached) return;
    viewer = nextViewer;
    unsubscribeFollow = viewer.onFollowEnd(() => {
      if (syncingFollow) return;
      el('follow').value = ''; el('follow-status').textContent = '';
      update();
    });
    el('follow').disabled = false;
    layer = createReplayLayer(viewer, selected.data, selected.replay); el('play').disabled = false; el('mp4').disabled = false; update();
    el('status').textContent = 'Trails and heatmap show movement up to the timeline cursor in this recording. Squad uses recorded team and commander ownership; soldier IDs identify individual lifetimes. Export includes full matching rounds and player/bot filters.';
  } };
}
