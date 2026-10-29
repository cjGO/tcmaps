// Experimental journals deliberately do not pass through the stable parser.
import { facingBetween, sourceEqual, sha256 } from './tactical-replay.js';
export const EXP_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, records: 250000, entities: 4096, positions: 2000000, line: 1024 * 1024 });
export const EFFECTS = Object.freeze({ shots: ['shot'], hits: ['hit', 'native_impact_probe'], deaths: ['death'], artillery: ['artillery_fire', 'projectile_launch', 'explosion'], contacts: ['ground_contact', 'water_contact', 'prop_contact', 'agent_contact', 'bounce_result'], fragments: ['fragment_launch'] });
export const EFFECT_WINDOWS = Object.freeze({ shots: 700, hits: 1200, deaths: 4000, artillery: 1600, contacts: 1600, fragments: 700 });
const TYPES = new Set(['header', 'player', 'change', 'entity', 'sample', 'remove', 'damage_override', 'projectile_segment', 'projectile_end', 'native_missile_probe', 'end', ...Object.values(EFFECTS).flat()]);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const str = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function check(ok, message) { if (!ok) throw new Error(message); }
function finiteTree(value, depth = 0) {
  check(depth <= 24, 'Metadata nesting exceeds limit');
  if (typeof value === 'number') check(Number.isFinite(value), 'Non-finite number');
  if (value && typeof value === 'object') for (const v of Object.values(value)) finiteTree(v, depth + 1);
}
function transform(v, optional = false) {
  check((optional && v === false) || (Array.isArray(v) && v.length === 6 && v.every((x, i) => Number.isFinite(x) && Math.abs(x) <= (i < 3 ? 10000000 : 36000))), 'Invalid transform (expected six finite centimetre/degree values)');
}
export function experimentalPose(v) {
  return { x: v[0] / 100, y: v[1] / 100, z: v[2] / 100, rx: v[3], ry: v[4], rz: v[5], facing: ((-v[5] % 360) + 360) % 360 };
}
// Cursor includes seq so stepping can reveal each event at a shared millisecond.
export function eventIndex(rows, t, seq = Infinity) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1, r = rows[mid]; if (r.t < t || (r.t === t && r.seq <= seq)) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
const before = (a, t, seq) => a.t < t || (a.t === t && a.seq <= seq);
const aliveAt = (track, t, seq) => before(track.birth, t, seq) && !before(track.end, t, seq);
function mix(a, b, u) {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u,
    rx: facingBetween(a.rx, b.rx, u), ry: facingBetween(a.ry, b.ry, u), rz: facingBetween(a.rz, b.rz, u), facing: facingBetween(a.facing, b.facing, u) };
}
function segmentPose(s, t) { return mix(s.from, s.to, s.duration === 0 ? 1 : Math.max(0, Math.min(1, (t - s.t) / s.duration))); }
export function metadataAt(track, t, seq = Infinity) {
  if (!track) return null;
  return track.changes?.[eventIndex(track.changes, t, seq)] ?? (before(track.birth, t, seq) ? track.meta : null);
}
export function experimentalSamplesJoin(a, b) {
  return b && b.t > a.t && b.t - a.t <= 10000 && b.snapshot >= a.snapshot && b.snapshot <= a.snapshot + 1;
}
export function entityAt(track, t, seq = Infinity) {
  if (!track || !aliveAt(track, t, seq)) return null;
  const i = eventIndex(track.samples, t, seq), a = track.samples[i], b = track.samples[i + 1];
  if (!a) return null;
  const joins = experimentalSamplesJoin(a, b);
  if (!joins && t - a.t > 5000) return null;
  const u = joins ? (t - a.t) / (b.t - a.t) : 0;
  return { ...mix(a, joins ? b : a, u), ...metadataAt(track, t, seq), id: track.id, t, seq, horse: a.horse, measured: t === a.t };
}
export function projectileAt(track, t, seq = Infinity) {
  if (!track || !aliveAt(track, t, seq)) return null;
  const s = track.segments[eventIndex(track.segments, t, seq)];
  return s ? { ...segmentPose(s, t), id: track.id, reconstructed: s.duration > 0 } : null;
}
function intervalTree(rows, lo = 0, hi = rows.length) {
  if (lo >= hi) return null;
  const mid = (lo + hi) >>> 1, track = rows[mid], left = intervalTree(rows, lo, mid), right = intervalTree(rows, mid + 1, hi);
  return { id: track.id, t: track.birth.t, end: track.end.t, max: Math.max(track.end.t, left?.max ?? -Infinity, right?.max ?? -Infinity), left, right };
}
export function activeProjectiles(replay, t, seq = Infinity, limit = 512) {
  const result = [];
  function visit(node) {
    if (!node || node.max < t || result.length >= limit) return;
    visit(node.left);
    if (result.length >= limit) return;
    if (node.t <= t && node.end >= t) { const p = projectileAt(replay.projectiles.get(node.id), t, seq); if (p) result.push(p); }
    if (node.t <= t) visit(node.right);
  }
  visit(replay.projectileTree); return result;
}
export function effectsAt(replay, t, seq = Infinity, layers = {}, limit = 512) {
  const result = [];
  for (const [family, rows] of Object.entries(replay.effects)) {
    if (layers[family] === false) continue;
    const end = eventIndex(rows, t, seq), start = Math.max(eventIndex(rows, t - EFFECT_WINDOWS[family]) + 1, end - limit + 1);
    for (let i = start; i <= end; i++) result.push({ event: rows[i], family, age: (t - rows[i].t) / EFFECT_WINDOWS[family] });
  }
  return result;
}
export function parseExperimentalJournal(input) {
  check(typeof input === 'string' && input.length <= EXP_LIMITS.bytes && new TextEncoder().encode(input).length <= EXP_LIMITS.bytes, 'Experimental recording exceeds 64 MiB');
  const cut = input.lastIndexOf('\n'), truncated = cut !== input.length - 1;
  check(cut >= 0, 'Missing newline-terminated experimental header');
  const players = new Map(), tracks = new Map(), projectiles = new Map(), engineAgents = new Map(), engineProps = new Map();
  const records = [], counts = {}, byType = {}, effects = Object.fromEntries(Object.keys(EFFECTS).map(k => [k, []])), overrides = new Map();
  let header, terminal, lastT = -1, positions = 0, snapshot = 0, offset = 0;
  while (offset <= cut) {
    const end = input.indexOf('\n', offset), line = input.slice(offset, end); offset = end + 1;
    const number = records.length + 1;
    try {
      check(number <= EXP_LIMITS.records, 'Record limit exceeded');
      check(line.length > 0 && line.length <= EXP_LIMITS.line && new TextEncoder().encode(line).length <= EXP_LIMITS.line, 'Record exceeds 1 MiB or is empty');
      let row; try { row = JSON.parse(line); } catch { throw new Error('Malformed JSON'); }
      check(object(row) && TYPES.has(row.type), 'Unknown experimental event type'); finiteTree(row);
      check(!terminal, 'Record after terminal summary');
      check(int(row.t, Math.max(0, lastT)) && int(row.seq, 1) && row.seq === number, 'Non-monotonic timestamp or non-contiguous sequence');
      if (number === 1) {
        check(row.type === 'header' && row.schema === 'warband-experimental-replay' && [1, 2].includes(row.version), 'Unsupported experimental schema/version; stable replays use the Replays tab');
        check(str(row.id, 128) && str(row.created_utc, 40) && Number.isFinite(Date.parse(row.created_utc)) && row.clock === 'mission_timer_a_msec' && row.clock_resolution_ms === 1 && row.position_units === 'centimetres' && row.rotation_units === 'native_euler_degrees', 'Invalid experimental header or units');
        check(int(row.start_ms, 0, row.t) && int(row.round_start_seconds) && row.partial_round === true && row.sample_interval_ms === 5000 && ['practice', 'battle'].includes(row.capture_mode) && typeof row.synthetic === 'boolean' && row.complete === false, 'Invalid capture time/mode');
        // Frozen fixed-map entries use id/kind/source and omit available/scene.
        // The recorder's missing-identity fallback instead supplies available:false/scene.
        check(object(row.map) && (row.map.available === undefined || typeof row.map.available === 'boolean') && (row.map.scene === undefined || int(row.map.scene)) && object(row.build) && object(row.capabilities), 'Invalid map/build/capabilities');
        check((row.map.kind === undefined || ['fixed', 'generated'].includes(row.map.kind)) && (row.map.id === undefined || str(row.map.id, 128)), 'Invalid fixed/generated map identity fields');
        for (const k of ['map_id', 'map_name', 'variant_id', 'variant_revision', 'variant_filename', 'version']) check(row.map[k] === false || typeof row.map[k] === 'string', `Invalid map.${k}`);
        check(row.map.source === false || (object(row.map.source) && ['sco_sha256', 'recipe_sha256', 'terrain_code'].every(k => row.map.source[k] === false || typeof row.map.source[k] === 'string')), 'Invalid map source');
        check(row.map.version === false || hash(row.map.version), 'Invalid map version hash');
        if (row.map.source) {
          for (const k of ['sco_sha256', 'recipe_sha256']) check(row.map.source[k] === false || hash(row.map.source[k]), `Invalid map source ${k}`);
          check(row.map.source.terrain_code === false || /^0x[0-9a-fA-F]{48}$/.test(row.map.source.terrain_code), 'Invalid terrain code');
        }
        check(Object.values(row.capabilities).every(v => typeof v === 'boolean' || typeof v === 'string'), 'Invalid capability declaration');
        check(object(row.fog) && Number.isFinite(row.fog.distance_m) && int(row.fog.colour_rgb, 0, 0xffffff), 'Invalid fog');
        header = row;
      } else {
        check(row.type !== 'header', 'Duplicate header');
        for (const field of ['shooter', 'attacker', 'victim', 'killer', 'projectile_shooter']) if (field in row) check(row[field] === false || (int(row[field], 1) && tracks.has(row[field])), `Unknown ${field} entity reference`);
        if ('projectile' in row && row.projectile !== false) check(int(row.projectile, 1) && projectiles.has(row.projectile), 'Unknown projectile reference');
        if (EFFECTS.contacts.includes(row.type) && row.projectile !== false && row.projectile !== undefined) check(aliveAt(projectiles.get(row.projectile), row.t, row.seq), 'Contact outside projectile lifetime');
        if ('parent' in row && row.parent !== false) check(int(row.parent, 1, number - 1) && ['artillery_fire', 'explosion'].includes(records[row.parent - 1]?.type), 'Invalid parent discharge/explosion reference');
        if ('hit' in row && row.hit !== false) check(int(row.hit, 1, number - 1) && records[row.hit - 1]?.type === 'hit', 'Invalid hit override reference');
        const required = fields => { for (const k of fields) check(Object.hasOwn(row, k), `Missing ${k}`); };
        const integers = fields => { required(fields); for (const k of fields) check(int(row[k], -1, 0x7fffffff), `Invalid ${k}`); };
        const parameters = n => check(Array.isArray(row.movement_parameters) && row.movement_parameters.length === n && row.movement_parameters.every(Number.isFinite), 'Invalid movement parameters');
        if ('position' in row) transform(row.position, ['entity', 'death', 'remove'].includes(row.type));
        const positionTypes = ['entity', 'death', 'remove', 'shot', 'hit', 'artillery_fire', 'projectile_launch', 'explosion', 'fragment_launch', 'native_impact_probe', ...EFFECTS.contacts];
        if (positionTypes.includes(row.type)) required(['position']);
        const identity = () => {
          check(['bot', 'player', 'horse'].includes(row.kind), 'Invalid entity kind');
          integers(['troop', 'team']);
          for (const key of ['owner', 'controller']) check(row[key] === false || (int(row[key], 1) && players.has(row[key])), `Unknown ${key} player reference`);
          check(row.player_name === false || typeof row.player_name === 'string', 'Invalid player name');
          if (row.kind === 'horse') check(['owner','controller','player_name','class','unit_category'].every(k => row[k] === false), 'Invalid horse identity');
          else {
            check(int(row.class, -1, 0x7fffffff), 'Invalid troop class');
            const category = row.class >= 14 && row.class <= 19 ? 'cavalry' : [20,21].includes(row.class) ? 'artillery' : 'infantry';
            check(row.unit_category === category, 'Troop class/category mismatch');
          }
          check(row.controller === false ? row.player_name === false : row.kind === 'player' && row.player_name === players.get(row.controller).name, 'Controller/name mismatch');
        };
        switch (row.type) {
          case 'player':
            check(header.version === 2 && int(row.id, 1) && !players.has(row.id) && typeof row.name === 'string', 'Invalid/duplicate player');
            players.set(row.id, row); break;
          case 'change': {
            const track = tracks.get(row.id);
            check(header.version === 2 && track && aliveAt(track, row.t, row.seq), 'Change outside entity lifetime');
            identity(); track.changes.push(row); break;
          }
          case 'entity': {
            integers(['engine_agent', 'troop', 'team']);
            check(int(row.id, 1) && !tracks.has(row.id) && tracks.size < EXP_LIMITS.entities && !engineAgents.has(row.engine_agent) && ['bot', 'player', 'horse'].includes(row.kind), 'Duplicate/invalid entity lifetime or entity limit exceeded');
            if (header.version === 2) identity();
            const track = { id: row.id, meta: row, changes: [row], birth: row, end: { t: Infinity, seq: Infinity }, samples: [] };
            if (row.position) track.samples.push({ t: row.t, seq: row.seq, ...experimentalPose(row.position), snapshot, horse: -1 });
            tracks.set(row.id, track); engineAgents.set(row.engine_agent, row.id); break;
          }
          case 'sample': {
            check(Array.isArray(row.p) && row.p.length <= EXP_LIMITS.entities, 'Invalid movement snapshot'); snapshot++;
            const seen = new Set();
            for (const point of row.p) {
              check(Array.isArray(point) && point.length === 3 && int(point[0], 1) && int(point[2], -1, 0x7fffffff), 'Invalid movement row'); transform(point[1]);
              const track = tracks.get(point[0]);
              check(track && aliveAt(track, row.t, row.seq) && !seen.has(point[0]), 'Sample outside entity lifetime or duplicate sample');
              check(++positions <= EXP_LIMITS.positions, 'Movement position limit exceeded'); seen.add(point[0]);
              track.samples.push({ t: row.t, seq: row.seq, ...experimentalPose(point[1]), snapshot, horse: point[2] });
            } break;
          }
          case 'remove': case 'death': {
            const track = tracks.get(row.id); required(['killer']);
            check(track && aliveAt(track, row.t, row.seq) && str(row.reason, 128), 'Removal outside entity lifetime or invalid reason');
            track.end = row; engineAgents.delete(track.meta.engine_agent);
            if (row.position) track.samples.push({ t: row.t, seq: row.seq, ...experimentalPose(row.position), snapshot: snapshot + 1, horse: -1 });
            break;
          }
          case 'shot': required(['shooter', 'direction']); integers(['weapon']); check(str(row.direction), 'Invalid direction annotation');
            check(row.shooter === false || aliveAt(tracks.get(row.shooter), row.t, row.seq), 'Shot outside shooter lifetime'); break;
          case 'hit': required(['victim', 'attacker', 'projectile', 'projectile_shooter']); integers(['weapon', 'ammo']);
            check(Number.isFinite(row.reported_damage) && row.damage_semantics === 'incoming_trigger_value', 'Invalid incoming damage'); break;
          case 'damage_override': required(['hit']); check(Number.isFinite(row.value) && row.damage_semantics === 'script_override_not_verified_health_loss', 'Invalid damage override');
            if (row.hit !== false) { if (!overrides.has(row.hit)) overrides.set(row.hit, []); overrides.get(row.hit).push(row); } break;
          case 'artillery_fire': required(['shooter']); integers(['cannon', 'ammo']); break;
          case 'projectile_launch': {
            required(['shooter', 'parent']); integers(['instance', 'ammo']); parameters(3);
            check(int(row.id, 1) && !projectiles.has(row.id), 'Duplicate/invalid projectile lifetime');
            const prior = projectiles.get(engineProps.get(row.instance));
            if (prior && prior.end.t === Infinity) prior.end = { t: row.t, seq: row.seq, reason: 'engine_instance_reused' };
            const pose = experimentalPose(row.position);
            projectiles.set(row.id, { id: row.id, meta: row, birth: row, end: { t: Infinity, seq: Infinity }, segments: [{ t: row.t, seq: row.seq, from: pose, to: pose, duration: 0 }] });
            engineProps.set(row.instance, row.id); break;
          }
          case 'projectile_segment': {
            required(['projectile']); integers(['instance']); transform(row.target);
            check(int(row.duration_centiseconds, 0, 8640000), 'Invalid segment duration');
            if (row.projectile !== false) {
              const track = projectiles.get(row.projectile);
              check(aliveAt(track, row.t, row.seq) && track.meta.instance === row.instance, 'Segment outside projectile lifetime or instance mismatch');
              track.segments.push({ t: row.t, seq: row.seq, from: segmentPose(track.segments.at(-1), row.t), to: experimentalPose(row.target), duration: row.duration_centiseconds * 10 });
            } break;
          }
          case 'projectile_end': {
            required(['projectile']); integers(['reason']); check(row.projectile !== false, 'Untracked projectile end');
            const track = projectiles.get(row.projectile); check(aliveAt(track, row.t, row.seq), 'End outside projectile lifetime'); track.end = row; break;
          }
          case 'ground_contact': required(['projectile']); parameters(2); break;
          case 'bounce_result': required(['projectile']); parameters(2); check(typeof row.stop === 'boolean', 'Invalid bounce decision');
            if (row.projectile !== false) {
              const track = projectiles.get(row.projectile); check(aliveAt(track, row.t, row.seq), 'Bounce outside projectile lifetime');
              // The bounce callback measures an actual replacement position.
              const pose = experimentalPose(row.position); track.segments.push({ t: row.t, seq: row.seq, from: pose, to: pose, duration: 0 });
            } break;
          case 'water_contact': required(['projectile']); break;
          case 'prop_contact': required(['projectile']); integers(['prop']); break;
          case 'agent_contact': required(['projectile', 'victim']); break;
          case 'explosion': required(['projectile', 'shooter']); check(Number.isFinite(row.max_damage) && Number.isFinite(row.radius_cm) && row.radius_cm >= 0 && row.radius_cm <= 10000000, 'Invalid explosion radius/damage'); break;
          case 'fragment_launch': required(['projectile', 'shooter', 'parent']); integers(['launcher', 'ammo']); check(Number.isFinite(row.speed), 'Invalid fragment speed'); break;
          case 'native_missile_probe': required(['shooter']); integers(['launcher', 'ammo', 'missile']); break;
          case 'native_impact_probe': required(['shooter']); integers(['collision']); break;
          case 'end':
            check(typeof row.complete === 'boolean' && str(row.reason, 128) && row.coverage_complete === false && int(row.dropped_events) && row.positions === positions && object(row.counts), 'Invalid terminal summary/position total');
            check(Object.keys(row.counts).length === Object.keys(counts).length && Object.entries(counts).every(([k, n]) => row.counts[k] === n), 'Terminal event counts disagree'); terminal = row; break;
        }
      }
      records.push(row); counts[row.type] = (counts[row.type] || 0) + 1; (byType[row.type] ??= []).push(row);
      for (const [family, types] of Object.entries(EFFECTS)) if (types.includes(row.type)) effects[family].push(row);
      lastT = row.t;
    } catch (error) { throw new Error(`Line ${number}: ${error.message}`); }
  }
  const warnings = [];
  if (truncated) warnings.push('Unterminated final line omitted.');
  if (!terminal?.complete || truncated) warnings.push('Incomplete recording: no reliable complete terminal summary.');
  if (terminal?.dropped_events) warnings.push(`${terminal.dropped_events} events reported dropped.`);
  return { header, terminal, records, players, tracks, projectiles, counts, byType, effects, overrides, positions, warnings, truncated,
    incomplete: !terminal?.complete || truncated, first: header.start_ms, last: lastT, duration: lastT - header.start_ms,
    events: records.filter(r => !['header', 'sample', 'end'].includes(r.type)), projectileTree: intervalTree([...projectiles.values()]) };
}
export function terrainCandidate(replay, entries) {
  const map = replay.header.map;
  if (map.available === false || !hash(map.source?.sco_sha256) || !hash(map.source?.recipe_sha256) || !hash(map.version)) return null;
  return entries.find(e => sourceEqual(map.source, e.source) && ['map_id', 'variant_id', 'variant_revision'].every(k => map[k] === false || map[k] === e[k])) ?? null;
}
export function terrainOverlayCandidate(replay, entries) {
  const map = replay.header.map;
  if (map.available === false || map.kind === 'generated' || !str(map.map_id)) return null;
  // A scene slot or filename can be reused. Only the public map identity may
  // select a fallback, and ambiguous variants must stay on the neutral grid.
  const matches = entries.filter(e => e.map_id === map.map_id &&
    ['variant_id', 'variant_revision'].every(k => map[k] === false || map[k] === e[k]));
  return matches.length === 1 ? matches[0] : null;
}
export async function verifyExperimentalTerrain(replay, data, entry, manual = false) {
  check(data.schema_version === 1 && hash(data.height_data_sha256) && sourceEqual(data.source, entry.source), 'Terrain provenance mismatch');
  const b = data.bounds, n = data.grid_size;
  check(b && [b.x_min_m, b.x_max_m, b.y_min_m, b.y_max_m, data.min_height_m, data.max_height_m, data.relief_m].every(Number.isFinite) && b.x_max_m > b.x_min_m && b.y_max_m > b.y_min_m && Math.max(b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m) <= 2000 && int(n, 2, 501), 'Invalid terrain bounds');
  check(data.vertical_scale === 1 && data.height_order === 'x-major, y-minor' && [data.xs, data.ys].every(a => Array.isArray(a) && a.length === n && a.every((v, i) => Number.isFinite(v) && Math.abs(v) <= 100000 && (!i || v > a[i - 1]))) && Array.isArray(data.heights_mm) && data.heights_mm.length === n * n && data.heights_mm.every(v => int(v, -10000000, 10000000)), 'Invalid terrain grid');
  check(Array.isArray(data.spawns) && data.spawns.length === 2 && data.spawns.every(p => [p.x_m, p.y_m, p.z_m].every(Number.isFinite)), 'Invalid terrain spawns');
  if (manual === 'map-id') {
    check(terrainOverlayCandidate(replay, [entry]), 'Terrain map identity mismatch');
    return { verified: false, label: 'UNVERIFIED terrain overlay · matched test map automatically; recorded version differs or is unverified; alignment unknown' };
  }
  if (manual) return { verified: false, label: 'UNVERIFIED terrain overlay · selected manually; alignment unknown' };
  check(terrainCandidate(replay, [entry]) && replay.header.map.version === await sha256(`${data.source.sco_sha256}:${data.source.recipe_sha256}`), 'Recorded terrain version mismatch');
  return { verified: true, label: 'Exact recorded terrain · recorded source identity verified' };
}
export function neutralReference(replay) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = 0, zmax = 0;
  for (const track of replay.tracks.values()) for (const p of track.samples) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); }
  for (const rows of Object.values(replay.effects)) for (const r of rows) if (r.position) { const p = experimentalPose(r.position); xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); }
  if (!Number.isFinite(xmin)) { xmin = ymin = 0; xmax = ymax = 100; }
  xmin -= 25; ymin -= 25; xmax += 25; ymax += 25;
  // This is viewer framing only, never substituted into the recorded map metadata.
  return { id: 'Neutral reference grid (not terrain)', grid_size: 2, xs: [xmin, xmax], ys: [ymin, ymax], heights_mm: [0, 0, 0, 0], height_order: 'x-major, y-minor', vertical_scale: 1,
    bounds: { x_min_m: xmin, x_max_m: xmax, y_min_m: ymin, y_max_m: ymax }, min_height_m: zmin, max_height_m: zmax, relief_m: zmax - zmin, spawns: [], source: { terrain_code: '0x0' } };
}
export function experimentalFrame(replay, t, seq = Infinity, layers = {}, density = 512) {
  if (t < replay.first || t > replay.last) return { entities: [], projectiles: [], effects: [] };
  return { entities: [...replay.tracks.values()].map(track => entityAt(track, t, seq)).filter(Boolean),
    projectiles: layers.artillery === false ? [] : activeProjectiles(replay, t, seq, density), effects: effectsAt(replay, t, seq, layers, density) };
}
