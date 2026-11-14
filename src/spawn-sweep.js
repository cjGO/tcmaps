import { groundHeight } from './editor-spatial.js';

export const STORAGE_KEY = 'rate-maps.spawn-sweep.v1';
export const sourceKey = row => [row.map_id, row.source.sco_sha256, row.source.recipe_sha256].join(':');
export const editablePoints = points => points.map(({ team, entry, x_m, y_m }) => ({ team, entry, x_m: Number(x_m.toFixed(3)), y_m: Number(y_m.toFixed(3)) }));
export function validateRecord(row) {
  if (!row || !/^test_map_\d+$/.test(row.map_id) || row.target_variant !== 'SPAWNPOINT' || row.source_variant !== 'source'
      || !['draft', 'reviewed'].includes(row.status) || !['sco_sha256', 'recipe_sha256'].every(k => /^[a-f0-9]{64}$/.test(row.source?.[k]))) throw new Error('Invalid map/source identity in spawn backup');
  const b = row.bounds;
  if (!b || !['x_min_m', 'x_max_m', 'y_min_m', 'y_max_m'].every(k => Number.isFinite(b[k])) || b.x_min_m >= b.x_max_m || b.y_min_m >= b.y_max_m) throw new Error('Invalid terrain bounds');
  for (const points of [row.default_spawn_points, row.spawn_points]) {
    if (!Array.isArray(points) || points.length !== 2) throw new Error('Expected two team spawns');
    points.forEach((p, i) => {
      if (p.team !== i || p.entry !== i * 32 || !Number.isFinite(p.x_m) || !Number.isFinite(p.y_m)
          || p.x_m < b.x_min_m || p.x_m > b.x_max_m || p.y_m < b.y_min_m || p.y_m > b.y_max_m) throw new Error('Invalid team or spawn outside terrain');
    });
  }
  if (row.spawn_points.some(p => [p.x_m, p.y_m].some(n => Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6))) throw new Error('Use at most three decimal places');
  if (row.spawn_points[0].x_m === row.spawn_points[1].x_m && row.spawn_points[0].y_m === row.spawn_points[1].y_m) throw new Error('Team spawns must differ');
  return row;
}
export function parseBackup(raw) {
  const value = JSON.parse(raw);
  if (value.schema !== 'rate-maps.spawn-sweep' || value.version !== 1 || !Array.isArray(value.maps)) throw new Error('Unsupported spawn backup');
  const records = {};
  for (const row of value.maps) {
    validateRecord(row);
    const key = sourceKey(row);
    if (records[key]) throw new Error('Duplicate map/source in backup');
    records[key] = row;
  }
  return records;
}
export const backup = records => JSON.stringify({ schema: 'rate-maps.spawn-sweep', version: 1, exported_at: new Date().toISOString(), coordinate_system: 'scene XY metres; entries 0 and 32; resolve Z on source terrain', maps: Object.values(records) }, null, 2);
export function sweepCSV(records) {
  const columns = ['map_id', 'source_variant', 'target_variant', 'status', 'sco_sha256', 'recipe_sha256', 'team', 'entry', 'x_m', 'y_m', 'original_x_m', 'original_y_m'];
  const rows = Object.values(records).flatMap(r => r.spawn_points.map((p, i) => [r.map_id, r.source_variant, r.target_variant, r.status, r.source.sco_sha256, r.source.recipe_sha256, p.team, p.entry, p.x_m, p.y_m, r.default_spawn_points[i].x_m, r.default_spawn_points[i].y_m]));
  return [columns, ...rows].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
}
function download(text, extension) {
  const href = URL.createObjectURL(new Blob([text], { type: extension === 'json' ? 'application/json' : 'text/csv' }));
  const a = document.createElement('a'); a.href = href; a.download = `spawn-sweep-${new Date().toISOString().slice(0, 10)}.${extension}`; a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
export function setupSpawnSweep(panel, reload, currentSources) {
  const root = document.createElement('section'); root.className = 'spawn-sweep';
  root.innerHTML = `<label><input type="checkbox" data-enable> Spawn sweep · edit Source / RAW → SPAWNPOINT</label>
    <p>Changes save in this browser. Export JSON regularly for a portable backup. Review each map, then use the rotation arrows to continue.</p>
    <div class="topology-controls"><button data-json>Export JSON backup</button><button data-csv>Export CSV</button><label>Restore JSON <input type="file" accept=".json,application/json" data-import></label></div>
    <label data-source-label hidden>RAW revision <select data-source></select></label><p data-progress></p><div data-editor hidden><div class="topology-controls">${[0,1].map(i => `<fieldset><legend>Team ${i + 1} · entry ${i * 32}</legend><label>X metres <input type="number" step="0.001" data-x="${i}"></label><label>Y metres <input type="number" step="0.001" data-y="${i}"></label><button data-pick="${i}">Place Team ${i + 1} on terrain</button></fieldset>`).join('')}</div><label>Notes <input data-notes maxlength="2000"></label><button data-reviewed>Mark reviewed & next map</button><button data-reset>Reset to RAW spawns</button></div><p data-status role="status"></p>`;
  panel.append(root);
  const q = s => root.querySelector(s), status = message => { q('[data-status]').textContent = message; };
  let records = {}, active, viewer, data, pickTeam = null, detach = () => {}, storageOK = true, storedRaw = null, candidates = [];
  try { const raw = localStorage.getItem(STORAGE_KEY); storedRaw = raw; if (raw) records = parseBackup(raw); }
  catch (e) { storageOK = false; status(`Cannot read saved progress: ${e.message}. Existing storage is preserved; restore a JSON backup to recover.`); }
  const enabled = () => q('[data-enable]').checked;
  function progress() {
    const sources = currentSources();
    const reviewed = new Set(sources.filter(r => records[sourceKey(r)]?.status === 'reviewed').map(r => r.map_id)).size;
    const mapCount = new Set(sources.map(r => r.map_id)).size;
    q('[data-progress]').textContent = `${reviewed} / ${mapCount} available RAW maps reviewed · ${Object.keys(records).length} saved drafts/reviews (including archived sources).`;
  }
  function persist(next) {
    if (!storageOK) throw new Error('Saved storage could not be read. Export this session or restore a valid backup first.');
    if (localStorage.getItem(STORAGE_KEY) !== storedRaw) throw new Error('Another tab changed the sweep. Export this tab’s JSON before reloading to reconcile edits');
    const raw = backup(next); localStorage.setItem(STORAGE_KEY, raw); storedRaw = raw; records = next; progress();
  }
  function render() {
    active.spawn_points.forEach((p, i) => { q(`[data-x="${i}"]`).value = p.x_m; q(`[data-y="${i}"]`).value = p.y_m; });
    q('[data-notes]').value = active.notes || '';
    viewer.updateSpawns(active.spawn_points.map(p => ({ ...p, z_m: groundHeight(data, p.x_m, p.y_m) })));
  }
  function save(reviewed = false) {
    const next = structuredClone(active);
    next.spawn_points = next.spawn_points.map((p, i) => ({ ...p, x_m: q(`[data-x="${i}"]`).value === '' ? NaN : Number(q(`[data-x="${i}"]`).value), y_m: q(`[data-y="${i}"]`).value === '' ? NaN : Number(q(`[data-y="${i}"]`).value) }));
    next.notes = q('[data-notes]').value; next.status = reviewed ? 'reviewed' : 'draft'; next.updated_at = new Date().toISOString();
    validateRecord(next);
    // Keep in-memory edits available for export even if the browser refuses writes.
    active = next; records = { ...records, [sourceKey(next)]: next }; render();
    persist(records); status(`${next.map_id}: ${next.status} saved in this browser.`);
  }
  function attempt(fn) { try { fn(); } catch (e) { status(`Not saved: ${e.message}. Export JSON to back up valid edits.`); } }
  q('[data-enable]').onchange = () => { q('[data-source-label]').hidden = !enabled(); reload(); };
  q('[data-source]').onchange = reload;
  q('[data-json]').onclick = () => download(backup(records), 'json');
  q('[data-csv]').onclick = () => download(sweepCSV(records), 'csv');
  q('[data-import]').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      const imported = parseBackup(await file.text());
      // Refuse conflicts rather than silently replacing work from another session.
      for (const [key, row] of Object.entries(imported)) if (records[key] && JSON.stringify(records[key]) !== JSON.stringify(row)) throw new Error(`Conflicting saved edits for ${row.map_id}; export your current backup first and resolve the conflict before restoring`);
      const next = { ...records, ...imported };
      if (localStorage.getItem(STORAGE_KEY) !== storedRaw) throw new Error('Another tab changed the sweep; export this tab before reloading');
      const raw = backup(next); localStorage.setItem(STORAGE_KEY, raw); storedRaw = raw; storageOK = true; records = next; progress(); reload(); status('Backup restored.');
    } catch (e) { status(`Restore failed: ${e.message}`); }
    event.target.value = '';
  };
  root.querySelectorAll('input[type=number], [data-notes]').forEach(input => input.addEventListener('change', () => attempt(() => save())));
  q('[data-reviewed]').onclick = () => attempt(() => { save(true); document.getElementById('rotation-next')?.click(); });
  q('[data-reset]').onclick = () => attempt(() => { active = { ...active, spawn_points: editablePoints(active.default_spawn_points) }; render(); save(); });
  root.querySelectorAll('[data-pick]').forEach(button => { button.onclick = () => { pickTeam = Number(button.dataset.pick); viewer.exitExplorer(); viewer.navigation(false); status(`Click terrain for Team ${pickTeam + 1}. Right-drag to orbit.`); }; });
  function clear() { detach(); detach = () => {}; q('[data-editor]').hidden = true; active = null; pickTeam = null; }
  function attach(terrain, terrainData, nextViewer) {
    clear(); if (!enabled()) return;
    viewer = nextViewer; data = terrainData;
    active = structuredClone(records[sourceKey(terrain)] || { map_id: terrain.map_id, scene_id: terrain.id, source_variant: 'source', target_variant: 'SPAWNPOINT', source: terrain.source, terrain_sha256: terrain.sha256, bounds: data.bounds, default_spawn_points: data.spawns, spawn_points: editablePoints(data.spawns), status: 'draft', notes: '' });
    validateRecord(active);
    if (JSON.stringify(active.default_spawn_points) !== JSON.stringify(data.spawns) || JSON.stringify(active.bounds) !== JSON.stringify(data.bounds)) throw new Error('Saved RAW defaults or bounds differ; refusing to apply this draft');
    q('[data-editor]').hidden = false; render(); status(`${active.map_id} · ${active.status}. Editing RAW terrain.`);
    const click = event => {
      if (pickTeam === null || event.button !== 0) return;
      const hit = viewer.pick(event.clientX, event.clientY)[0]; if (!hit) return;
      q(`[data-x="${pickTeam}"]`).value = hit.point.x.toFixed(3); q(`[data-y="${pickTeam}"]`).value = hit.point.y.toFixed(3);
      pickTeam = null; viewer.navigation(true); attempt(() => save());
    };
    viewer.canvas.addEventListener('click', click); detach = () => viewer.canvas.removeEventListener('click', click);
  }
  function configure(rows) {
    const previous = q('[data-source]').value;
    candidates = [...new Map(rows.map(row => [sourceKey(row), row])).values()];
    const select = q('[data-source]'); select.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose RAW revision (required when archives differ)'; select.append(placeholder);
    for (const row of candidates) {
      const option = document.createElement('option'); option.value = sourceKey(row);
      option.textContent = `${row.map_id} · SCO ${row.source.sco_sha256.slice(0,12)} · recipe ${row.source.recipe_sha256.slice(0,12)}${records[sourceKey(row)] ? ' · ' + records[sourceKey(row)].status : ''}`;
      select.append(option);
    }
    const saved = candidates.filter(row => records[sourceKey(row)]);
    select.value = candidates.some(row => sourceKey(row) === previous) ? previous : candidates.length === 1 ? sourceKey(candidates[0]) : saved.length === 1 ? sourceKey(saved[0]) : '';
  }
  function terrain() {
    const selected = candidates.find(row => sourceKey(row) === q('[data-source]').value);
    if (!candidates.length) throw new Error('No registered RAW terrain is available for this map. Its source must be imported before collecting spawn edits.');
    if (!selected) throw new Error('Choose a RAW revision in Spawn sweep above. Each archive has its own source hashes and saved progress.');
    return selected;
  }
  progress(); return { enabled, attach, clear, configure, terrain };
}
