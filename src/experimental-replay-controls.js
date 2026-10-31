import { EXP_LIMITS, EFFECTS, eventIndex, metadataAt, neutralReference, terrainCandidate, terrainOverlayCandidate, verifyExperimentalTerrain } from './experimental-replay.js';
import { sha256 } from './tactical-replay.js';
import { replayAssets, replayVariantAssets } from './replay-variant-assets.js';
import './experimental-replay.css';
import { resolveDisplayMetadata, UNIT_TYPES, metadataTemplate, parseDisplayMetadata, displayMeta, movementAdapter, experimentalViewAt, experimentalStrengthAt } from './experimental-replay-presentation.js';
import { createBotStrengthChart } from './replay-strength.js';

const syntheticURL = new URL('../tests/fixtures/SYNTHETIC-experimental-artillery.jsonl', import.meta.url).href;
const elapsed = ms => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(3).padStart(6, '0')}`;
const capabilityKeys = { shots: 'shots', hits: 'hits', artillery: 'artillery', contacts: 'artillery', fragments: 'artillery' };
export function capabilitySummary(replay) {
  const c = replay.header.capabilities;
  return ['shots', 'hits', 'artillery', 'native_missiles', 'native_impacts', 'exact_native_shot_hit_link'].map(k => `${k.replaceAll('_', ' ')}: ${c[k] === undefined || c[k] === false ? 'not captured / unavailable' : String(c[k])}`).join(' · ');
}
export function setupExperimentalReplay(root) {
  root.innerHTML = `<div class="exp-toolbar"><label>Open local v2 recording<input data-exp="file" type="file" accept=".jsonl,application/x-ndjson"></label><label>Demo<select data-exp="examples"><option value="">Choose an example</option></select></label><button data-exp="example">Open example</button><button data-exp="clear">Clear</button></div>
    <p data-exp="status" role="status">Select a v2 replay or open a local recording.</p>
    <div data-exp="loaded" hidden>
      <div class="exp-summary"><span class="exp-badge">v2</span><strong data-exp="title"></strong><p data-exp="summary"></p><p data-exp="warnings"></p></div>
      <div class="exp-transport"><button data-exp="play" aria-pressed="false" disabled>▶ Play</button><button data-exp="restart">Restart</button><button data-exp="previous">← Event</button><button data-exp="next">Event →</button><label>Speed<select data-exp="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>5</option><option>10</option><option>30</option><option>60</option></select>×</label><label class="exp-scrubber">Capture elapsed<input data-exp="timeline" aria-label="Experimental replay timeline" type="range" step="1"></label><output data-exp="time"></output></div>
      <p class="exp-alignment" data-exp="alignment" role="status"></p>
      <div class="exp-toolbar"><label>Terrain overlay<select data-exp="terrain"><option value="">Neutral reference grid</option></select></label><label>Camera<select data-exp="camera"><option value="aerial">Aerial</option><option value="overhead">Overhead</option><option value="reverse">Opposite side</option></select></label><label>Height<select data-exp="height"><option value="1">1× · true scale</option><option value="2">2×</option><option value="4">4×</option></select></label><label>Unit placement<select data-exp="placement"><option value="terrain">Follow terrain</option><option value="recorded">Recorded heights</option></select></label><button data-exp="reset">Reset view</button></div>
      <div class="exp-stage" data-exp="stage"></div>
      <p data-exp="visible" class="exp-muted"></p>
      <div data-exp="strength" class="exp-strength replay-strength"></div>
      <fieldset class="exp-layers"><legend>Soldiers & movement</legend><div>
        <label><input data-exp="players" type="checkbox" checked>Players</label><label><input data-exp="bots" type="checkbox" checked>Bots</label><label><input data-exp="horses" type="checkbox" checked>Explicit horses</label><label><input data-exp="names" type="checkbox" checked>Player names</label><label><input data-exp="bot-deaths" type="checkbox" checked>Persistent bot deaths</label><label><input data-exp="heatmap" type="checkbox">Movement heatmap</label>
      </div><div data-exp="unit-types"></div><div class="exp-toolbar"><label>Soldier<select data-exp="soldier"><option value="">All soldiers</option></select></label><label>Squad<select data-exp="squad"><option value="">All squads</option></select></label><label>Follow soldier<select data-exp="follow"><option value="">Free camera</option></select></label><button data-exp="export-heat">Export heatmap CSV</button></div><p data-exp="follow-status" class="exp-muted"></p>
      <div><label><input data-layer="trails" type="checkbox" checked>Movement trails</label><label>Trail opacity<input data-exp="trail-opacity" type="range" min="0" max="100" value="35"></label><label>Death opacity<input data-exp="death-opacity" type="range" min="0" max="100" value="40"></label></div><div data-exp="trail-types" aria-label="Trail unit types"></div><div data-exp="death-types" aria-label="Death marker unit types"></div></fieldset>
      <details><summary>Names, unit classes & squads</summary><p data-exp="display-status"></p><p>New captures include player identities, squad ownership and timestamped troop roles. Older recordings cannot recover missing names; matching legacy builds use a bundled table of declared troop roles. Load optional display metadata for names, squads or role overrides. Imported files are user-supplied annotations; original events stay intact. Mounted units use triangles while mounted; units without a known class use hollow diamonds.</p><div class="exp-toolbar"><button data-exp="metadata-template">Download display metadata</button><label>Load display metadata<input data-exp="display-file" type="file" accept=".json,application/json"></label><button data-exp="clear-metadata">Clear display metadata</button></div></details>
      <fieldset class="exp-layers"><legend>Visible layers</legend><div data-exp="layers"></div><label>Effect density <select data-exp="density"><option value="64">Light · 64 per layer</option><option value="128" selected>Standard · 128 per layer</option><option value="512">Detailed · 512 per layer</option></select></label><p class="exp-muted">Density limits particles and projectile markers only. Every soldier and source event remains available.</p></fieldset>
      <p class="exp-legend">Blue: Team 1 · Red: Team 2 · Yellow: other teams. Triangles: cavalry · Squares: infantry · Circles: artillery · Hollow diamonds: unknown class · White rings: players · Rectangles: explicit horses · Team-colored crosses: confirmed bot deaths. Gold: shots · Pink: hits · Dark rings: deaths · Orange: artillery/explosions · Teal: contacts · Purple: fragments/projectiles. Follow terrain keeps unit markers, death crosses and trails above the displayed terrain; Recorded heights shows the original elevations. Terrain overlays may differ from the recorded map. Combat effects and projectiles retain recorded elevations. Event markers are recorded locations; agent paths and projectile motion between commands are reconstructed. Orientation ticks show native Z heading only, not verified bullet direction. Soldier trails accumulate from capture start, including dead units; gaps are not bridged. Projectile trails show the current command. Death markers use the measured death position, or the last observed position if absent. Heatmaps show reconstructed soldier-seconds so far.</p>
      <div class="exp-toolbar"><label>Focus type<select data-exp="focus-type"><option value="entity">Entity</option><option value="projectile">Projectile</option></select></label><label>Recording-local ID<input data-exp="focus-id" type="number" min="1" step="1" value="1"></label><button data-exp="focus">Focus at current time</button><output data-exp="focus-status"></output></div>
      <details><summary>Coverage, counts & original metadata</summary><p data-exp="capabilities"></p><p>Missing capability means not captured, not zero events occurred. Native probe records describe that capture only. Exact native shot-to-hit linkage is unavailable. Capture starts at activation; round-start seconds are separate metadata.</p><p>Incoming damage and script overrides are separate reported values; neither is verified health loss. Contacts are script-measured positions, not guaranteed mesh intersections. Fragment launches have no tracked flight or manufactured impacts.</p><p>Recorded fog is preserved below. This preview uses viewer lighting/haze; native fog semantics and sentinel values are not applied.</p><p data-exp="counts"></p><pre data-exp="metadata"></pre></details>
      <div class="exp-toolbar exp-unavailable"><button disabled title="Experimental combat effects are not supported by the video exporter">Export MP4</button><span>Video export is unavailable for experimental combat recordings.</span></div>
      <section class="exp-inspector"><h2>Event inspector</h2><div class="exp-toolbar"><label>Event type<select data-exp="type"><option value="">All event types</option></select></label><label>Search recorded fields<input data-exp="search" type="search" placeholder="Entity, weapon, ammo, reason…"></label></div><p data-exp="results"></p><div class="exp-inspector-grid"><div><div data-exp="events" class="exp-events" role="region" aria-label="Experimental events"></div><div class="exp-toolbar"><button data-exp="page-back">Previous page</button><button data-exp="page-next">Next page</button></div></div><div><p data-exp="selected-note">Select an event to seek and inspect its original fields.</p><button data-exp="focus-event" disabled>Focus selected event</button><pre data-exp="raw" tabindex="0"></pre></div></div></section>
    </div>`;
  const el = name => root.querySelector(`[data-exp="${name}"]`);
  el('examples').append(new Option('SYNTHETIC · artillery, contacts & fragments', syntheticURL));
  if (el('examples').options.length > 1) el('examples').selectedIndex = 1;
  let manifest;
  const assetsReady = replayAssets.then(assets => {
    manifest = assets.manifest;
    for (const [i, map] of manifest.maps.entries()) el('terrain').append(new Option(`${map.map_id || map.id} · ${map.variant_id || 'source'} · unverified overlay`, String(i)));
  });
  const assetNotice = document.createElement('p'); assetNotice.dataset.exp = 'assets'; assetNotice.setAttribute('role', 'status'); el('alignment').after(assetNotice);
  let variantLayer;
  for (const name of [...Object.keys(EFFECTS), 'orientation', 'radii']) {
    const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !['orientation', 'radii'].includes(name); checkbox.dataset.layer = name;
    label.append(checkbox, name === 'trails' ? 'Full soldier trails / projectile paths' : name === 'deaths' ? 'Death event flashes' : name === 'radii' ? 'Recorded explosion radii' : name === 'orientation' ? 'Orientation ticks (not bullet paths)' : name[0].toUpperCase() + name.slice(1)); el('layers').append(label);
    checkbox.addEventListener('change', update);
  }
  for (const group of ['unit-types', 'trail-types', 'death-types']) {
    if (group !== 'unit-types') { const heading = document.createElement('span'); heading.textContent = group === 'trail-types' ? 'Trails:' : 'Death markers:'; el(group).append(heading); }
    for (const type of UNIT_TYPES) { const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.value = type; label.append(input, type[0].toUpperCase() + type.slice(1)); el(group).append(label); input.addEventListener('change', update); }
  }
  let metadata, strengthChart, syncingFollow = false;
  let replay, data, viewer, layer, visible = false, t = 0, seq = Infinity, playing = false, raf, previousTime, generation = 0, loadGeneration = 0, terrainGeneration = 0, worker, rejectWorker;
  let filtered = [], page = 0, selected, searchTimer, alignment = 'Unaligned 3D preview · neutral reference grid; map identity unavailable', reference = true;
  let frameSamples = [], lastStats;
  root.querySelector('[data-layer=trails]').addEventListener('change', update);
  const layers = () => Object.fromEntries([...root.querySelectorAll('[data-layer]')].map(e => [e.dataset.layer, e.checked]));
  const selectedTypes = group => [...el(group).querySelectorAll('input:checked')].map(e => e.value);
  const displayOptions = () => ({ terrainPlacement: el('placement').value === 'terrain', players: el('players').checked, bots: el('bots').checked, horses: el('horses').checked, playerNames: el('names').checked, botDeaths: el('bot-deaths').checked, heatmap: el('heatmap').checked, soldier: el('soldier').value, squad: el('squad').value, follow: el('follow').value, unitTypes: selectedTypes('unit-types'), trailUnitTypes: selectedTypes('trail-types'), deathUnitTypes: selectedTypes('death-types'), trailOpacity: Number(el('trail-opacity').value) / 100, deathOpacity: Number(el('death-opacity').value) / 100 });
  function populateDisplay() {
    for (const [key, title] of [['soldier', 'All soldiers'], ['follow', 'Free camera'], ['squad', 'All squads']]) el(key).replaceChildren(new Option(title, ''));
    const effectiveMetadata = resolveDisplayMetadata(replay, metadata);
    const squads = new Set(); let names = 0, classes = 0;
    for (const track of replay.tracks.values()) {
      if (track.meta.kind === 'horse') continue;
      const meta = displayMeta(track, track.samples[0], effectiveMetadata); if (meta.player_name) names++; if (meta.unit_category !== 'unknown') classes++;
      const title = `${meta.label} · #${track.id} · Team ${meta.team + 1} · ${meta.unit_category}`;
      for (const key of ['soldier', 'follow']) el(key).append(new Option(title, String(track.id)));
      for (const change of track.changes || [track.meta]) { const value = displayMeta(track, change, effectiveMetadata); if (value.squad) squads.add(value.squad); }
    }
    for (const squad of [...squads].sort()) el('squad').append(new Option(squad, squad));
    el('squad').disabled = !squads.size;
    el('display-status').textContent = `${metadata ? 'User-supplied display metadata loaded.' : 'Using recorded fields and observed horse links.'} ${effectiveMetadata.buildMatched ? 'Build-matched declared troop roles applied.' : ''} ${names} named players · ${classes} classified units at introduction. Unnamed players use Player #ID.`;
  }
  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function stop() { playing = false; cancelAnimationFrame(raf); previousTime = undefined; el('play').textContent = '▶ Play'; el('play').setAttribute('aria-pressed', 'false'); }
  function detach() { variantLayer?.dispose(); variantLayer = null; assetNotice.textContent = ''; generation++; stop(); layer?.dispose(); viewer?.dispose(); layer = viewer = null; el('stage').replaceChildren(); el('play').disabled = true; }
  function update() {
    if (!replay) return;
    strengthChart?.update(t);
    // The graph groups a millisecond; the live totals also respect event-step sequence.
    for (const [team, count] of experimentalStrengthAt(replay, t, seq)) { const output = el('strength').querySelector(`[aria-label="${team < 0 ? 'Unassigned' : `Team ${team + 1}`} bots alive"]`); if (output) output.textContent = count; }
    const follow = el('follow').value, pose = follow && experimentalViewAt(replay.tracks.get(Number(follow)), t, seq);
    el('follow-status').textContent = !follow ? '' : !pose ? 'Waiting for the first recorded position.' : pose.ended ? 'Unit removed; holding the final recorded position.' : pose.holding ? 'Recording gap; holding the last recorded position.' : 'Following recorded position and facing. Press Escape to return to the free camera.';
    syncingFollow = true;
    try { if (pose) viewer?.followSoldier(pose); else if (follow) viewer?.stopFollowing(); } finally { syncingFollow = false; }
    const started = performance.now();
    lastStats = layer?.update({ t, seq, layers: layers(), density: Number(el('density').value), ...displayOptions() });
    if (lastStats) { frameSamples.push(performance.now() - started); if (frameSamples.length > 600) frameSamples.shift(); }
    el('timeline').value = t;
    el('time').textContent = `${elapsed(t - replay.first)} / ${elapsed(replay.duration)}${seq !== Infinity ? ` · sequence ${seq}` : ''}`;
    el('visible').textContent = lastStats ? `${lastStats.soldiers} soldiers · ${lastStats.horses} horses · ${lastStats.projectiles} projectiles · ${lastStats.effects} active effects · ${lastStats.botDeaths} bot death markers · ${lastStats.trailSegments} trail segments. ${lastStats.historyError || ''} Display caps: ${el('density').value} per effect layer/projectiles; source counts remain intact.` : 'Preparing 3D preview…';
  }
  async function attach() {
    detach(); if (!visible || !replay || !data) return;
    const token = generation;
    try {
      const [{ createTopologyViewer }, { createExperimentalLayer }] = await Promise.all([import('./topology-viewer.js'), import('./experimental-replay-layer.js')]);
      if (token !== generation) return;
      viewer = createTopologyViewer(el('stage'), data, message => { stop(); el('status').textContent = message; }, { referenceGrid: reference });
      viewer.canvas.setAttribute('aria-label', 'Experimental replay 3D preview. Drag to orbit, scroll to zoom, right-drag to pan.');
      if (reference) for (const button of el('stage').querySelectorAll('[data-ui=explore], [data-ui=pick]')) {
        button.disabled = true; button.title = 'Walking needs measured terrain; this view is an unaligned reference grid.';
      }
      const variant = !reference && await replayVariantAssets(replay.header.map);
      if (token !== generation) return;
      if (variant) {
        assetNotice.textContent = `Loading ${variant.label} assets…`;
        const { createVariantLayer } = await import('./rotation-variant-layer.js');
        if (token !== generation) return;
        // Manual overlays must also match the placement file's base terrain.
        variantLayer = createVariantLayer(viewer, data, variant.document);
        await variantLayer.ready;
        if (token !== generation) return;
        assetNotice.textContent = `Variant assets loaded: ${variant.label} · ${variant.document.placements.length} placements · recorded revision matched.`;
      }
      layer = createExperimentalLayer(viewer, data, replay, { reference, metadata, select: ref => {
        if (ref.event) selectEvent(replay.records[ref.event - 1]);
        else { const kind = ref.entity ? 'entity' : 'projectile'; el('focus-type').value = kind; el('focus-id').value = ref[kind]; showRaw((kind === 'entity' ? replay.tracks : replay.projectiles).get(ref[kind]).meta); }
      } });
      viewer.onFollowEnd(() => { if (syncingFollow) return; el('follow').value = ''; update(); });
      viewer.exaggeration(Number(el('height').value)); viewer.preset(el('camera').value); viewer.resize(); update(); el('play').disabled = false;
    } catch (error) { detach(); el('status').textContent = `3D unavailable: ${error.message}. The event inspector remains available.`; }
  }
  function cancelParsing() { worker?.terminate(); worker = null; rejectWorker?.(new Error('Import replaced')); rejectWorker = null; }
  function parse(text) {
    cancelParsing();
    return new Promise((resolve, reject) => {
      const activeWorker = new Worker(new URL('./experimental-replay-worker.js', import.meta.url), { type: 'module' });
      rejectWorker = reject; worker = activeWorker;
      function finish(value, error) {
        if (worker !== activeWorker) return; // Ignore queued messages from a replaced import.
        activeWorker.terminate(); worker = null; rejectWorker = null;
        error ? reject(new Error(error)) : resolve(value);
      }
      activeWorker.onmessage = ({ data }) => finish(data.replay, data.error);
      activeWorker.onerror = () => finish(null, 'Experimental parser worker failed');
      activeWorker.postMessage(text);
    });
  }
  async function load(getText) {
    const token = ++loadGeneration; terrainGeneration++; cancelParsing(); stop(); el('status').textContent = 'Reading and validating experimental recording…';
    try {
      const text = await getText(); if (token !== loadGeneration) return;
      const start = performance.now(), next = await parse(text); if (token !== loadGeneration) return;
      detach(); strengthChart?.dispose(); metadata = undefined; replay = next; populateDisplay(); strengthChart = createBotStrengthChart(el('strength'), movementAdapter(replay), time => { stop(); t = time; seq = Infinity; update(); }); el('strength').querySelector('p').textContent = 'Recorded bot lifetimes by team, independent of display filters and position gaps. Coverage starts at recorder activation. Click the chart to seek.'; selected = undefined; frameSamples = []; t = replay.first; seq = Infinity; data = neutralReference(replay); reference = true;
      el('loaded').hidden = false; el('title').textContent = replay.header.id;
      el('summary').textContent = `Captured from activation · ${elapsed(replay.duration)} · ${replay.header.capture_mode} · ${replay.incomplete ? 'INCOMPLETE' : 'Complete capture'} · ${replay.header.synthetic ? 'SYNTHETIC fixture' : 'Recorded session'} · ${replay.terminal?.reason || 'interrupted'} · ${replay.tracks.size} entity lifetimes · ${replay.records.length} records`;
      el('warnings').textContent = [...replay.warnings, ...(!replay.positions ? ['This capture contains no movement snapshots. It cannot show movement trails; open a longer recording.'] : [])].join(' '); el('capabilities').textContent = capabilitySummary(replay);
      el('counts').textContent = Object.entries(replay.counts).map(([k, n]) => `${k}: ${n}`).join(' · ') + ` · sampled positions: ${replay.positions}`;
      el('metadata').textContent = JSON.stringify({ header: replay.header, terminal: replay.terminal }, null, 2);
      el('terrain').value = ''; el('timeline').min = replay.first; el('timeline').max = replay.last;
      el('raw').textContent = ''; el('focus-event').disabled = true;
      el('selected-note').textContent = 'Select an event to seek and inspect its original fields.';
      el('type').replaceChildren(new Option('All event types', ''));
      for (const type of Object.keys(replay.byType).filter(k => !['header', 'sample', 'end'].includes(k))) el('type').append(new Option(`${type} (${replay.counts[type]})`, type));
      for (const checkbox of el('layers').querySelectorAll('input')) {
        const family = checkbox.dataset.layer, key = capabilityKeys[family];
        checkbox.disabled = !!(key && !replay.effects[family]?.length && (!replay.header.capabilities[key] || String(replay.header.capabilities[key]).includes('disabled')));
        checkbox.parentElement.title = checkbox.disabled ? 'Not captured: no capability declaration or recorded events.' : '';
      }
      el('search').value = ''; filterEvents();
      alignment = 'Unaligned 3D preview · neutral reference grid; recorded terrain is unavailable';
      el('alignment').textContent = alignment;
      el('status').textContent = `Imported locally in ${(performance.now() - start).toFixed(0)} ms (worker parse, indexing and transfer). Recorded locations are distinct from reconstructed motion.`;
      await assetsReady; if (token !== loadGeneration) return;
      const exact = terrainCandidate(replay, manifest.maps);
      const candidate = exact || terrainOverlayCandidate(replay, manifest.maps);
      if (candidate) { el('terrain').value = String(manifest.maps.indexOf(candidate)); await useTerrain(candidate, exact ? false : 'map-id'); }
      else await attach();
    } catch (error) { if (token === loadGeneration) el('status').textContent = `Experimental recording could not load: ${error.message}`; }
    return replay;
  }
  async function useTerrain(entry, manual = true) {
    const token = ++terrainGeneration, r = replay; stop();
    if (!entry) { data = neutralReference(replay); reference = true; alignment = 'Unaligned 3D preview · neutral reference grid; no terrain alignment claimed'; el('alignment').textContent = alignment; await attach(); return; }
    el('alignment').textContent = 'Checking selected terrain asset…';
    try {
      const response = await fetch(import.meta.env.BASE_URL + entry.url.replace(/^\//, '')); if (!response.ok) throw new Error('Terrain could not load');
      const text = await response.text(); if (text.length > 8 * 1024 * 1024) throw new Error('Terrain exceeds 8 MiB');
      if (await sha256(text) !== entry.sha256) throw new Error('Terrain asset checksum mismatch');
      const next = JSON.parse(text), result = await verifyExperimentalTerrain(r, next, entry, manual);
      if (token !== terrainGeneration || r !== replay) return;
      data = next; reference = false; alignment = `${result.label} · ${entry.map_id || entry.id} · ${entry.variant_id || 'source'}`;
      el('alignment').textContent = alignment; await attach();
    } catch (error) {
      if (token !== terrainGeneration || r !== replay) return;
      data = neutralReference(replay); reference = true; el('terrain').value = ''; alignment = `Unaligned neutral grid · ${error.message}`; el('alignment').textContent = alignment; await attach();
    }
  }
  function showRaw(event) {
    selected = event; el('focus-event').disabled = !event.position;
    const extra = {};
    if (event.type === 'hit') extra.linked_damage_overrides = replay.overrides.get(event.seq) || [];
    if (event.type === 'damage_override' && event.hit) extra.incoming_hit = replay.records[event.hit - 1];
    if (event.parent) extra.parent_event = replay.records[event.parent - 1];
    if (event.projectile) extra.projectile_launch = replay.projectiles.get(event.projectile)?.meta;
    for (const k of ['shooter', 'attacker', 'victim', 'killer', 'projectile_shooter']) if (event[k]) extra[k + '_entity'] = metadataAt(replay.tracks.get(event[k]), event.t, event.seq);
    el('raw').textContent = JSON.stringify({ event, ...extra }, null, 2);
    el('selected-note').textContent = `${event.type} · ${elapsed(event.t - replay.first)} · sequence ${event.seq}. Original fields below; numeric IDs are preserved.`;
    for (const button of el('events').querySelectorAll('button')) button.setAttribute('aria-pressed', String(Number(button.dataset.seq) === event.seq));
  }
  function selectEvent(event) { if (!event) return; stop(); t = event.t; seq = event.seq; showRaw(event); update(); }
  function filterEvents() {
    if (!replay) return;
    const type = el('type').value, q = el('search').value.trim().toLowerCase();
    filtered = (type ? replay.byType[type] : replay.events).filter(r => !q || JSON.stringify(r).toLowerCase().includes(q)); page = 0; renderEvents();
  }
  function renderEvents() {
    el('events').replaceChildren();
    const start = page * 100, slice = filtered.slice(start, start + 100);
    el('results').textContent = `${filtered.length} matching events · ${filtered.length ? start + 1 : 0}–${start + slice.length} shown. Click to seek; event stepping follows these filters.`;
    for (const r of slice) {
      const button = document.createElement('button'); button.dataset.seq = r.seq; button.setAttribute('aria-pressed', String(selected?.seq === r.seq));
      button.textContent = `${elapsed(r.t - replay.first)} · #${r.seq} · ${r.type}${r.id ? ` · ID ${r.id}` : ''}${r.shooter ? ` · shooter ${r.shooter}` : ''}${r.victim ? ` · victim ${r.victim}` : ''}`;
      button.addEventListener('click', () => selectEvent(r)); el('events').append(button);
    }
    el('page-back').disabled = page === 0; el('page-next').disabled = start + 100 >= filtered.length;
  }
  function tick(now) {
    if (!playing || !replay || !layer) return;
    if (previousTime !== undefined) t = Math.min(replay.last, t + Math.min(250, now - previousTime) * Number(el('speed').value));
    previousTime = now; seq = Infinity; update(); if (t >= replay.last) stop(); else raf = requestAnimationFrame(tick);
  }
  el('play').addEventListener('click', () => { if (playing) { stop(); return; } if (!layer) return; if (t >= replay.last) t = replay.first; playing = true; el('play').textContent = 'Ⅱ Pause'; el('play').setAttribute('aria-pressed', 'true'); raf = requestAnimationFrame(tick); });
  el('restart').addEventListener('click', () => { stop(); t = replay.first; seq = Infinity; update(); });
  el('timeline').addEventListener('input', () => { stop(); t = Number(el('timeline').value); seq = Infinity; update(); });
  el('previous').addEventListener('click', () => { const i = eventIndex(filtered, t, seq); selectEvent(filtered[i >= 0 && filtered[i].t === t && filtered[i].seq === seq ? i - 1 : i]); });
  el('next').addEventListener('click', () => selectEvent(filtered[eventIndex(filtered, t, seq) + 1]));
  el('type').addEventListener('change', filterEvents); el('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(filterEvents, 150); });
  el('page-back').addEventListener('click', () => { page--; renderEvents(); }); el('page-next').addEventListener('click', () => { page++; renderEvents(); });
  el('focus').addEventListener('click', () => { const ref = { [el('focus-type').value]: Number(el('focus-id').value) }; el('focus-status').textContent = layer?.focus(ref) ? 'Focused recorded entity/projectile.' : 'No recorded position for this ID at the current time.'; });
  el('focus-event').addEventListener('click', () => layer?.focus({ event: selected?.seq }));
  el('camera').addEventListener('change', () => viewer?.preset(el('camera').value)); el('height').addEventListener('change', () => { viewer?.exaggeration(Number(el('height').value)); update(); });
  el('reset').addEventListener('click', () => viewer?.preset(el('camera').value));
  for (const key of ['players', 'bots', 'horses', 'names', 'bot-deaths', 'heatmap', 'soldier', 'squad', 'placement']) el(key).addEventListener('change', update);
  for (const key of ['trail-opacity', 'death-opacity']) el(key).addEventListener('input', update);
  el('follow').addEventListener('change', () => { if (!el('follow').value) { syncingFollow = true; try { viewer?.stopFollowing(); } finally { syncingFollow = false; } } update(); });
  el('metadata-template').addEventListener('click', () => download(JSON.stringify(metadata || metadataTemplate(replay), null, 2), `${replay.header.id}.display.json`, 'application/json'));
  el('display-file').addEventListener('change', async event => {
    const file = event.target.files[0], current = replay; event.target.value = ''; if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error('Display metadata exceeds 1 MiB'); const next = parseDisplayMetadata(await file.text(), current); if (current !== replay) return; metadata = next; populateDisplay(); await attach(); }
    catch (error) { if (current === replay) el('display-status').textContent = `Display metadata could not load: ${error.message}`; }
  });
  el('clear-metadata').addEventListener('click', () => { metadata = undefined; populateDisplay(); attach(); });
  el('export-heat').addEventListener('click', () => {
    try { const rows = layer?.heatmap() || []; download('x_m,y_m,soldier_seconds\n' + rows.filter(row => row.soldier_seconds > 0).map(row => [row.x_m, row.y_m, row.soldier_seconds].join(',')).join('\n'), `${replay.header.id}-heatmap-${t}.csv`, 'text/csv'); } catch (error) { el('status').textContent = `Heatmap export unavailable: ${error.message}`; }
  });
  el('density').addEventListener('change', update);
  el('terrain').addEventListener('change', () => useTerrain(el('terrain').value === '' ? null : manifest?.maps[Number(el('terrain').value)]));
  el('file').addEventListener('change', async e => { const file = e.target.files[0]; if (file) await load(() => { if (file.size > EXP_LIMITS.bytes) throw new Error('File exceeds 64 MiB'); return file.text(); }); e.target.value = ''; });
  el('example').addEventListener('click', () => { const url = el('examples').value; if (url) load(async () => { const response = await fetch(url); if (!response.ok) throw new Error('Example could not load'); return response.text(); }); });
  el('clear').addEventListener('click', () => { loadGeneration++; terrainGeneration++; cancelParsing(); detach(); strengthChart?.dispose(); strengthChart = null; metadata = undefined; replay = data = null; filtered = []; selected = undefined; el('loaded').hidden = true; el('events').replaceChildren(); el('raw').textContent = el('metadata').textContent = ''; el('status').textContent = 'Experimental recording cleared.'; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  return { openReplay(recording) {
      return load(async () => {
        const response = await fetch(import.meta.env.BASE_URL + recording.url);
        if (!response.ok) throw new Error('Recording could not load');
        return response.text();
      });
    }, setVisible(value) { visible = value; if (!value) detach(); else if (replay && !viewer) attach(); },
    diagnostics() { const sorted = [...frameSamples].sort((a, b) => a - b); return { frames: sorted.length, median_ms: sorted[Math.floor(sorted.length * .5)], p95_ms: sorted[Math.floor(sorted.length * .95)], ...lastStats }; } };
}
