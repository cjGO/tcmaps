// Shared by the browser, exporter and tests. No DOM or filesystem access here.
export const MAX_BYTES = 64 * 1024 * 1024;
const fail = message => { throw new Error(message); };
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const sourceEqual = (a, b) => !!a && !!b && ['sco_sha256', 'recipe_sha256', 'terrain_code'].every(k => a[k] === b[k]);
function metadata(row) {
  if (!integer(row.team, -1, 15) || !['player', 'bot'].includes(row.kind) ||
      !integer(row.troop, 0, 100000) || !integer(row.class, -1, 10000) ||
      ![row.owner, row.controller].every(x => x === false || integer(x, 1, 100000))) fail('Invalid soldier metadata');
  if (row.player_name !== undefined && row.player_name !== false && !text(row.player_name)) fail('Invalid player name');
  if (row.unit_category !== undefined && !['infantry', 'artillery', 'cavalry'].includes(row.unit_category)) fail('Invalid unit category');
  return { team: row.team, kind: row.kind, troop: row.troop, class: row.class, owner: row.owner, controller: row.controller,
    player_name: row.player_name || false, unit_category: row.unit_category };
}
// Napoleonic Wars slot_troop_class values. Roles persist after dismounting.
export function unitCategory(row) {
  if (row.unit_category) return row.unit_category;
  if (row.class >= 14 && row.class <= 19) return 'cavalry';
  if (row.class === 20 || row.class === 21) return 'artillery';
  return row.mounted ? 'cavalry' : 'infantry';
}
export function playerLabel(row) {
  return row.player_name || `Player #${row.controller || row.id}`;
}
export function parseJournal(input) {
  if (typeof input !== 'string' || input.length > MAX_BYTES) fail('Replay exceeds the 64 MiB journal limit');
  // A non-newline-terminated last record may be torn. Never promote it to complete.
  const cut = input.lastIndexOf('\n');
  const truncated = cut < input.length - 1;
  const lines = input.slice(0, cut + 1).split('\n'); lines.pop();
  if (!lines.length || lines.length > 250000) fail('Empty replay or too many records');
  const tracks = new Map(); let header, end, previous = -1, count = 0, first, last, sampleTime = -1, sampleIndex = 0;
  for (const [index, line] of lines.entries()) {
    if (!line || line.length > 1024 * 1024) fail('Invalid replay record size');
    let row; try { row = JSON.parse(line); } catch { fail('Malformed replay JSON'); }
    if (!row || Array.isArray(row) || typeof row !== 'object') fail('Invalid replay record');
    if (index === 0) {
      header = row;
      if (row.type !== 'header' || row.schema !== 'warband-tactical-replay' || row.version !== 1) fail('Unsupported replay schema');
      if (!text(row.id, 128) || !text(row.round_id) || !text(row.created_utc, 40) || !Number.isFinite(Date.parse(row.created_utc)) ||
          ![5000, 10000].includes(row.sample_interval_ms) || !integer(row.start_ms, 0, 1e10) ||
          !integer(row.round_start_ms, 0, row.start_ms) || row.start_offset_ms !== row.start_ms - row.round_start_ms ||
          !integer(row.round_max_ms, 0, 86400000) || row.clock !== 'mission_timer_a' || row.clock_resolution_ms !== 1000 ||
          row.position_units !== 'centimetres' || row.facing_units !== 'millidegrees_clockwise_from_positive_y' ||
          row.complete !== false || typeof row.synthetic !== 'boolean') fail('Invalid replay header');
      if (!row.map || !text(row.map.id) || !['fixed', 'generated'].includes(row.map.kind)) fail('Invalid map identity');
      if (row.map.kind === 'fixed' && (!hash(row.map.version) || !hash(row.map.source?.sco_sha256) ||
          !hash(row.map.source?.recipe_sha256) || !/^0x[0-9a-fA-F]{48}$/.test(row.map.source?.terrain_code))) fail('Invalid terrain version');
      previous = row.start_ms; continue;
    }
    if (end || !integer(row.t, previous, header.start_ms + 86400000)) fail('Invalid replay event ordering or duration');
    previous = row.t;
    if (['entity', 'change', 'remove'].includes(row.type)) {
      if (!integer(row.id, 1, 4096)) fail('Invalid soldier ID');
      const track = tracks.get(row.id);
      if (row.type === 'entity') {
        if (track || tracks.size >= 4096 || !['spawn', 'observed'].includes(row.origin)) fail('Duplicate soldier lifetime');
        tracks.set(row.id, { id: row.id, birth: row.t, death: Infinity, samples: [], changes: [{ t: row.t, ...metadata(row) }] });
      } else {
        if (!track || track.death !== Infinity) fail('Event outside soldier lifetime');
        if (row.type === 'change') track.changes.push({ t: row.t, ...metadata(row) });
        else { if (!text(row.reason, 64) || row.position !== 'last_sample') fail('Invalid removal'); track.death = row.t; track.removalReason = row.reason; }
      }
    } else if (row.type === 'sample') {
      if (!Array.isArray(row.p) || row.p.length > 4096 || row.t <= sampleTime) fail('Invalid snapshot');
      sampleTime = row.t; first ??= row.t; last = row.t; sampleIndex++;
      const seen = new Set();
      for (const p of row.p) {
        const track = Array.isArray(p) && tracks.get(p[0]);
        if (!track || p.length !== 6 || seen.has(p[0]) || row.t < track.birth || row.t >= track.death ||
            !p.slice(1, 4).every(v => integer(v, -10000000, 10000000)) || !integer(p[4], 0, 359999) || ![0, 1].includes(p[5])) fail('Invalid soldier sample');
        if (++count > 2000000) fail('Replay contains too many position samples');
        seen.add(p[0]); track.samples.push({ t: row.t, x: p[1] / 100, y: p[2] / 100, z: p[3] / 100, facing: p[4] / 1000, mounted: !!p[5], index: sampleIndex });
      }
    } else if (row.type === 'end') {
      if (row.complete !== true || !text(row.reason, 64) || ![false, -1, 0, 1].includes(row.result) ||
          !integer(row.samples, 0, 100000) || row.samples !== sampleIndex ||
          !integer(row.round_start_ms, 0, row.t) || !integer(row.round_max_ms, 0, 86400000) ||
          ['snapshot_cpu_us_total', 'snapshot_cpu_us_max'].some(k => row[k] !== undefined && !integer(row[k], 0, 1e12))) fail('Invalid completion record');
      end = row;
    } else fail('Unsupported replay event');
  }
  if (first === undefined) fail('Replay contains no usable snapshots');
  return { header, end, tracks, first, last, incomplete: !end || truncated, truncated, sampleCount: sampleIndex,
    maxGap: header.sample_interval_ms * 2, coverageEnd: end?.t ?? last };
}
export function upperIndex(rows, t) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].t <= t) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
export function facingBetween(a, b, u) { return (a + (((b - a + 540) % 360) - 180) * u + 360) % 360; }
export function soldierAt(track, t, replay) {
  if (t < track.birth || t >= track.death || t < replay.first || t > replay.coverageEnd) return null;
  const i = upperIndex(track.samples, t), a = track.samples[i], b = track.samples[i + 1];
  if (!a) return null;
  let u = 0;
  if (b) {
    if (b.t - a.t > replay.maxGap || b.index !== a.index + 1) { if (t !== a.t) return null; }
    else u = (t - a.t) / (b.t - a.t);
  } else if (t - a.t > replay.header.sample_interval_ms) return null;
  const meta = track.changes[upperIndex(track.changes, t)];
  return { id: track.id, ...meta, x: a.x + ((b?.x ?? a.x) - a.x) * u,
    y: a.y + ((b?.y ?? a.y) - a.y) * u, z: a.z + ((b?.z ?? a.z) - a.z) * u,
    facing: facingBetween(a.facing, b?.facing ?? a.facing, u), mounted: a.mounted };
}
// Camera holds the last known pose through missing samples and after removal.
// Resolve from the timeline each time so seeking never retains a future pose.
export function soldierViewAt(track, t, replay) {
  if (!track || t < track.birth || t < replay.first || t > replay.coverageEnd) return null;
  const live = soldierAt(track, t, replay);
  const sample = track.samples[upperIndex(track.samples, Math.min(t, track.death))];
  if (!live && !sample) return null;
  return { ...(live || sample), ended: t >= track.death, holding: !live };
}
export function matchTerrain(replay, data) {
  if (replay.header.map.kind !== 'fixed') fail('3D unavailable: this generated map needs matching saved and measured terrain');
  if (!sourceEqual(replay.header.map.source, data.source)) fail('Terrain version mismatch; scene slots are not map identities');
  if (!hash(data.height_data_sha256) || data.schema_version !== 1) fail('Missing measured terrain provenance');
}
export async function sha256(textValue) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(textValue)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function parseBundle(input) {
  if (typeof input !== 'string' || input.length > MAX_BYTES + 12 * 1024 * 1024) fail('Replay bundle is too large');
  let bundle; try { bundle = JSON.parse(input); } catch { fail('Malformed replay bundle'); }
  if (!bundle || typeof bundle !== 'object' || bundle.schema !== 'warband-replay-bundle' || bundle.version !== 1) fail('Unsupported replay bundle schema');
  const replay = parseJournal(bundle.journal);
  return validateReplayTerrain(replay, bundle.terrain_json, bundle.terrain_sha256);
}

async function validateReplayTerrain(replay, terrainJSON, terrainHash, overlayEntry) {
  if (typeof terrainJSON !== 'string' || terrainJSON.length > 8 * 1024 * 1024 || !hash(terrainHash)) fail('Matching terrain is unavailable; export with a verified terrain asset');
  if (await sha256(terrainJSON) !== terrainHash) fail('Terrain asset checksum mismatch');
  let data; try { data = JSON.parse(terrainJSON); } catch { fail('Malformed terrain asset'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Malformed terrain asset');
  matchTerrain(overlayEntry ? { header: { map: { kind: 'fixed', source: overlayEntry.source } } } : replay, data);
  const version = await sha256(`${data.source.sco_sha256}:${data.source.recipe_sha256}`);
  if (!overlayEntry && replay.header.map.version !== version) fail('Map version checksum mismatch');
  const b = data.bounds;
  if (!b || ![b.x_min_m, b.x_max_m, b.y_min_m, b.y_max_m, data.min_height_m, data.max_height_m].every(Number.isFinite) ||
      b.x_max_m <= b.x_min_m || b.y_max_m <= b.y_min_m || b.x_max_m - b.x_min_m > 2000 || b.y_max_m - b.y_min_m > 2000) fail('Invalid terrain bounds');
  if (!Array.isArray(data.spawns) || data.spawns.length !== 2 || data.spawns.some(p => !p || ![p.x_m, p.y_m, p.z_m].every(Number.isFinite)) ||
      !integer(data.grid_size, 2, 501) || !Array.isArray(data.xs) || !Array.isArray(data.ys) || !Array.isArray(data.heights_mm) ||
      data.xs.length !== data.grid_size || data.ys.length !== data.grid_size || data.heights_mm.length !== data.grid_size ** 2 ||
      data.height_order !== 'x-major, y-minor' || data.vertical_scale !== 1) fail('Invalid measured terrain grid');
  if (!text(data.id, 128) || !Number.isFinite(data.relief_m) || data.relief_m < 0 || data.relief_m > 10000 ||
      [data.xs, data.ys].some(axis => axis.some((v, i) => !Number.isFinite(v) || Math.abs(v) > 100000 || (i && v <= axis[i - 1]))) ||
      data.heights_mm.some(v => !integer(v, -10000000, 10000000))) fail('Invalid terrain coordinates');
  return { replay, data, terrainHash, ...(overlayEntry ? { terrainMatch: 'unverified-map-id' } : {}) };
}

// Only a permanent public identity can select an unverified fallback. Scene
// slots and filenames may be reassigned, and ambiguous variants cannot align it.
export function recordingTerrainOverlay(map, entries) {
  if (map.kind !== 'fixed' || !/^test_map_\d+$/.test(map.map_id)) return null;
  const matches = entries.filter(entry => entry.map_id === map.map_id &&
    ['variant_id', 'variant_revision'].every(key => map[key] === undefined || map[key] === false || map[key] === entry[key]));
  return matches.length === 1 ? matches[0] : null;
}

// Raw journals prefer exact sources, then a unique public map/variant overlay.
// Bundles always retain strict recorded-source validation.
export async function parseRecording(input, { manifest, loadTerrain } = {}) {
  if (typeof input !== 'string' || input.length > MAX_BYTES + 12 * 1024 * 1024) fail('Recording is too large');
  let json;
  try { json = JSON.parse(input); } catch { /* Multiple JSONL records. */ }
  if (json?.schema === 'warband-replay-bundle') return parseBundle(input);
  const replay = parseJournal(input);
  if (replay.header.map.kind !== 'fixed') fail('3D unavailable: this generated map needs matching saved and measured terrain');
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.maps)) fail('Matching topology manifest is unavailable');
  const exact = manifest.maps.find(entry => sourceEqual(entry.source, replay.header.map.source));
  const match = exact || recordingTerrainOverlay(replay.header.map, manifest.maps);
  if (!match) fail('No exact terrain source version is available for this recording. Publish its matching measured topology or open a replay bundle with archived terrain.');
  if (typeof match.url !== 'string' || !/^\/topology\/[A-Za-z0-9_/-]+\.json$/.test(match.url) || !hash(match.sha256)) fail('Invalid terrain manifest entry');
  if (typeof loadTerrain !== 'function') fail('Matching terrain loader is unavailable');
  return validateReplayTerrain(replay, await loadTerrain(match.url), match.sha256, exact ? undefined : match);
}

// Each interval contributes soldier-seconds and estimated path metres. Sampling
// at twice the cell frequency is an explicit approximation, not measured tracks.
export function movementHeatmap(replays, data, { cell = 10, players = true, bots = true, unitTypes } = {}) {
  if (!integer(cell, 5, 100) || replays.length > 100) fail('Heatmap limits exceeded');
  const b = data.bounds, cells = new Map(), used = new Set(); let segments = 0, seconds = 0;
  for (const replay of replays) {
    matchTerrain(replay, data);
    if (replay.header.synthetic !== replays[0].header.synthetic) fail('Keep synthetic demonstrations separate from real rounds');
    if (used.has(replay.header.id)) continue; used.add(replay.header.id);
    for (const track of replay.tracks.values()) for (let i = 0; i + 1 < track.samples.length; i++) {
      const a = track.samples[i], z = track.samples[i + 1], dt = z.t - a.t;
      if (dt > replay.maxGap || z.index !== a.index + 1 || a.t >= track.death) continue;
      const distance = Math.hypot(z.x - a.x, z.y - a.y), stop = Math.min(z.t, track.death);
      // Clip metadata at recorded control changes, including bot takeover.
      const cuts = [a.t, ...track.changes.filter(m => m.t > a.t && m.t < stop).map(m => m.t), stop];
      for (let j = 0; j + 1 < cuts.length; j++) {
        const begin = cuts[j], end = cuts[j + 1], meta = track.changes[upperIndex(track.changes, begin)];
        if (meta.kind === 'player' ? !players : !bots) continue;
        if (unitTypes && !unitTypes.includes(unitCategory({ ...meta, mounted: a.mounted }))) continue;
        const steps = Math.max(1, Math.min(1000, Math.ceil(distance * (end - begin) / dt / (cell / 2))));
        for (let k = 0; k < steps; k++) {
          if (++segments > 4000000) fail('Heatmap work limit exceeded; import fewer rounds');
          const u = (begin - a.t + (k + .5) * (end - begin) / steps) / dt;
          const x = a.x + (z.x - a.x) * u, y = a.y + (z.y - a.y) * u;
          if (x < b.x_min_m || x >= b.x_max_m || y < b.y_min_m || y >= b.y_max_m) continue;
          const ix = Math.floor((x - b.x_min_m) / cell), iy = Math.floor((y - b.y_min_m) / cell), key = `${ix},${iy},${meta.team},${meta.kind},${a.mounted}`;
          const row = cells.get(key) || { ix, iy, team: meta.team, kind: meta.kind, mounted: a.mounted, seconds: 0, metres: 0 };
          row.seconds += (end - begin) / steps / 1000; row.metres += distance * (end - begin) / dt / steps;
          seconds += (end - begin) / steps / 1000; cells.set(key, row);
        }
      }
    }
  }
  return { schema: 'warband-movement-heatmap', version: 1, source: data.source, cell_metres: cell, bounds: b,
    synthetic: replays[0]?.header.synthetic ?? false, recordings: [...used], soldier_seconds: seconds, method: 'sampled_linear_segments_no_gaps_v1', cells: [...cells.values()] };
}
