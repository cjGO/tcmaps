import { attachSweepStats } from './spawn-sweep-stats.js';
import { attachSpawnMeasurements } from './spawn-measurements.js';
import maps from '../lib/editor-maps.json';
import template from '../map_editor/web/index.html?raw';
import styles from '../map_editor/web/style.css?raw';
import coordinates from '../map_editor/web/coordinates.js?raw';
import app from '../map_editor/web/app.js?raw';
import { SWEEP_STORAGE_KEY, mapKey, spawnCoordinates, pointsEqual, validateSweepRecord, parseSweep, sweepBackup, sweepProgress, coordinatesCSV } from './spawn-sweep-state.js';

export function setupSpawnSweepTab(root, { headers = [], rowsByMap = new Map() } = {}) {
  const playerColumn = headers.indexOf('player_count');
  const playerRange = { min: 1, max: Math.max(30, ...maps.flatMap(map => (rowsByMap.get(map.map_id) || []).map(row => Number(row[playerColumn]) || 0))) };
  root.innerHTML = `<div class="intro"><div><p class="eyebrow">LOCAL DEVELOPMENT</p><h1>Spawn sweep</h1><p class="subtitle">Drag the numbered team circles on each map’s 2D heatmap. Edits save in this browser as you work.</p></div></div>
    <div class="sweep-toolbar"><button data-sweep="previous">← Previous</button><label>Map <select data-sweep="map"></select></label><button data-sweep="next">Next →</button><button data-sweep="review">Mark reviewed & next</button><button data-sweep="csv">Export coordinates CSV</button><button data-sweep="backup">Export backup</button><label>Restore backup <input data-sweep="restore" type="file" accept=".json"></label></div>
    <p data-sweep="progress" aria-live="polite"></p><p>Blue/red stars show defaults; numbered circles are editable. Export includes both team spawns for every edited map, in scene metres.</p>
    <p data-sweep="status" role="status"></p><button data-sweep="retry" hidden>Retry map</button><div data-sweep="workspace"></div>`;
  const el = key => root.querySelector(`[data-sweep="${key}"]`);
  let records = {}, storedRaw = null, storageOK = true, index = 0, generation = 0, frame, unsubscribe, active, lastPoints, ready = false;
  const url = path => new URL(import.meta.env.BASE_URL + path, location.href).href;
  const status = text => { el('status').textContent = text; };
  try { storedRaw = localStorage.getItem(SWEEP_STORAGE_KEY); if (storedRaw) records = parseSweep(storedRaw); }
  catch (error) { storageOK = false; status(`Saved progress could not be read: ${error.message}. Restore a backup before editing.`); }
  const measurementCache = new Map();
  let measurementTools;
  const options = maps.map(map => new Option(map.map_id, mapKey(map)));
  el('map').append(...options);
  function progress() {
    const p = sweepProgress(maps, records);
    el('progress').textContent = `${p.edited} / ${p.total} maps edited · ${p.unedited} unedited · ${p.reviewed} / ${p.total} reviewed`;
    maps.forEach((map, i) => { const r = records[mapKey(map)]; options[i].textContent = `${map.map_id} · ${r && !pointsEqual(r.spawns, r.defaults) ? 'Edited' : 'Unedited'}${r?.reviewed ? ' · Reviewed' : ''}`; });
    el('csv').disabled = !p.edited;
    el('review').disabled = !ready;
  }
  function persist(record) {
    validateSweepRecord(record);
    records = { ...records, [mapKey(record)]: record };
    progress();
    if (!storageOK) throw new Error('Storage unavailable. Export a backup to preserve this session.');
    if (localStorage.getItem(SWEEP_STORAGE_KEY) !== storedRaw) throw new Error('Another tab changed saved progress. Export a backup before reloading.');
    const raw = sweepBackup(records);
    localStorage.setItem(SWEEP_STORAGE_KEY, raw); storedRaw = raw;
  }
  function download(value, extension) {
    const href = URL.createObjectURL(new Blob([value], { type: extension === 'csv' ? 'text/csv' : 'application/json' }));
    const a = document.createElement('a'); a.href = href; a.download = `spawn-sweep.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function open(next = index) {
    index = (next + maps.length) % maps.length;
    if (!maps.length) { status('No editor maps are available.'); return; }
    const map = maps[index], token = ++generation;
    ready = false; measurementTools?.dispose(); unsubscribe?.(); frame?.remove(); active = null; progress();
    el('map').value = mapKey(map); el('retry').hidden = true;
    status(`Loading ${map.map_id}…`);
    try {
      const response = await fetch(url(map.project));
      if (!response.ok) throw new Error('Map project could not load');
      const project = await response.json();
      if (token !== generation) return;
      project.display_name = map.map_id; project.spawn_sweep = true; project.assets = [];
      const defaults = spawnCoordinates(project.default_spawn_points);
      active = structuredClone(records[mapKey(map)] || { map_id: map.map_id, projectSha256: map.projectSha256, source: project.source, variant_id: map.variant_id, bounds: project.bounds, defaults, spawns: defaults, reviewed: false });
      validateSweepRecord(active);
      if (!pointsEqual(active.defaults, defaults) || !pointsEqual(active.bounds, project.bounds)) throw new Error('Saved defaults do not match this project');
      frame = document.createElement('iframe'); frame.className = 'map-editor-frame'; frame.title = `Spawn sweep — ${map.map_id}`;
      frame.srcdoc = template.replace('/* EDITOR_STYLE */', () => styles + `
        header, aside > :not(details:nth-of-type(2)):not(.sweep-round-stats), .file-actions, .instructions, #place, #count {display:none!important}
        main{grid-template-columns:260px minmax(0,1fr)} #viewport{height:70vh;min-height:440px}
        @media(max-width:700px){main{display:flex;flex-direction:column}#viewport{height:65vh;min-height:330px}}
      `).replace('/* EDITOR_CORE */', () => coordinates).replace('/* EDITOR_APP */', () => app)
        .replace('__EDITOR_DATA__', () => JSON.stringify(project).replaceAll('<', '\\u003c'))
        .replace('data:image/png;base64,__HEATMAP__', () => url(map.heatmap));
      frame.addEventListener('load', () => {
        if (token !== generation) return;
        try {
          const api = frame.contentWindow.MapEditor;
          if (!api) throw new Error('Heatmap editor could not start');
          api.loadDocument({ ...api.exportDocument(), spawn_points: active.spawns });
          api.setMode('select'); api.markSaved(); lastPoints = spawnCoordinates(active.spawns);
          unsubscribe = api.subscribe(({ document }) => {
            const points = spawnCoordinates(document.spawn_points);
            try {
              if (!pointsEqual(lastPoints, points)) {
                active = { ...active, spawns: points, reviewed: false };
                persist(active); lastPoints = points;
                status(`${map.map_id}: saved in this browser.`);
              }
              api.markSaved();
            } catch (error) { status(`Not saved: ${error.message}`); }
          });
          attachSweepStats(frame.contentDocument, map.map_id, headers, rowsByMap.get(map.map_id) || [], playerRange);
          measurementTools = attachSpawnMeasurements(frame, measurementCache.get(mapKey(map)) || [], guides => measurementCache.set(mapKey(map), guides));
          const image = frame.contentDocument.getElementById('heatmap');
          const failed = () => { if (token === generation) { status('Heatmap could not load. Retry this map.'); el('retry').hidden = false; } };
          image.addEventListener('error', failed);
          if (image.complete && !image.naturalWidth) failed();
          else status(`${map.map_id}: drag either numbered circle to move its spawn.`);
          frame.style.height = 'max(850px, 85vh)';
          api.status('Drag the numbered circles. Changes save automatically. Undo/redo are available.');
          ready = true; progress();
        } catch (error) { status(error.message); el('retry').hidden = false; }
      });
      el('workspace').replaceChildren(frame);
    } catch (error) { if (token === generation) { status(error.message); el('retry').hidden = false; } }
  }
  el('map').onchange = () => open(maps.findIndex(map => mapKey(map) === el('map').value));
  el('previous').onclick = () => open(index - 1); el('next').onclick = () => open(index + 1);
  el('retry').onclick = () => open(index);
  el('review').onclick = () => { try { persist({ ...active, reviewed: true }); open(index + 1); } catch (error) { status(`Not saved: ${error.message}`); } };
  el('csv').onclick = () => download(coordinatesCSV(maps, records), 'csv');
  el('backup').onclick = () => download(sweepBackup(records), 'json');
  el('restore').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      const imported = parseSweep(await file.text());
      for (const [key, row] of Object.entries(imported)) if (records[key] && !pointsEqual(records[key], row)) throw new Error('Backup conflicts with current edits. Export your current backup first.');
      if (localStorage.getItem(SWEEP_STORAGE_KEY) !== storedRaw) throw new Error('Another tab changed saved progress. Reload before restoring.');
      const next = { ...records, ...imported }, raw = sweepBackup(next);
      localStorage.setItem(SWEEP_STORAGE_KEY, raw); records = next; storedRaw = raw; storageOK = true; progress(); open(index);
    } catch (error) { status(`Restore failed: ${error.message}`); }
    event.target.value = '';
  };
  progress();
  return { show() { if (!frame) open(); } };
}
