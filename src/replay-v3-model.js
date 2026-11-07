// Viewer-only deductions. Never add events to, or change, the parsed journal.
import { eventIndex, experimentalPose, metadataAt } from './experimental-replay.js';
import { displayMeta, resolveDisplayMetadata, matchesDisplay } from './experimental-replay-presentation.js';

export const INFERENCE = Object.freeze({ windowMs: 3000, maxSpeed: 450, minSpeed: 40, minDistance: .2, headingDegrees: 10, closeRange: 10, lingerMs: 700 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const ordered = (a, b) => a.t - b.t || a.seq - b.seq;
const hasPassed = (event, t, seq) => event.t < t || (event.t === t && event.seq <= seq);
const key = (agent, weapon) => `${agent}:${weapon}`;

export function participant(replay, id, event) {
  const track = replay.tracks.get(id);
  if (!track) return { id, label: 'Unknown', squad: '', team: -1, unit_category: 'unknown' };
  const sample = track.samples[eventIndex(track.samples, event.t, event.seq)];
  return displayMeta(track, sample, resolveDisplayMetadata(replay), event.t, event.seq);
}

export function buildCombatIndex(replay) {
  const shots = replay.byType.shot || [], hits = replay.byType.hit || [];
  const queues = new Map(), proposed = [], uses = new Map(), reasons = {}, unresolved = [];
  let eligibleHits = 0;
  const reject = (hit, reason) => { reasons[reason] = (reasons[reason] || 0) + 1; unresolved.push({ hit: hit.seq, reason }); };
  for (const event of replay.records) {
    if (event.type === 'shot' && event.shooter !== false && event.weapon >= 0) {
      const k = key(event.shooter, event.weapon), queue = queues.get(k) || [];
      // At most one bounded time window per recording-local shooter / weapon.
      while (queue.length && queue[0].t < event.t - INFERENCE.windowMs) queue.shift();
      queue.push(event); queues.set(k, queue);
    }
    if (event.type !== 'hit' || event.ammo < 0 || event.weapon < 0 || event.projectile !== false || event.projectile_shooter !== false) continue;
    eligibleHits++;
    if (event.attacker === false) { reject(event, 'unknown_attacker'); continue; }
    const queue = queues.get(key(event.attacker, event.weapon)) || [];
    while (queue.length && queue[0].t < event.t - INFERENCE.windowMs) queue.shift();
    if (queue.length !== 1) { reject(event, queue.length ? 'multiple_candidate_shots' : 'no_candidate_shot'); continue; }
    const shot = queue[0], from = experimentalPose(shot.position), to = experimentalPose(event.position), duration = event.t - shot.t;
    const range = distance(from, to), speed = range / (duration / 1000);
    const heading = Math.atan2(-(to.x - from.x), to.y - from.y) * 180 / Math.PI;
    const headingError = Math.abs(((heading - from.rz) % 360 + 540) % 360 - 180);
    // Register every temporal candidate before geometry checks. Multiple impacts
    // cannot quietly become a confident one-to-one link because one was rejected.
    uses.set(shot.seq, (uses.get(shot.seq) || 0) + 1);
    if (duration <= 0) { reject(event, 'no_measurable_flight_time'); continue; }
    if (range < INFERENCE.minDistance || speed > INFERENCE.maxSpeed || (range >= INFERENCE.closeRange && speed < INFERENCE.minSpeed)) { reject(event, 'implausible_distance_or_time'); continue; }
    if (range >= INFERENCE.closeRange && headingError > INFERENCE.headingDegrees) { reject(event, 'heading_disagrees'); continue; }
    proposed.push({ id: shot.seq, t: shot.t, seq: shot.seq, end: event.t, hitSeq: event.seq, shooter: shot.shooter, victim: event.victim,
      weapon: shot.weapon, ammo: event.ammo, from, to, duration, range, headingError,
      source: 'inferred_from_recorded_shot_and_hit', shot, hit: event,
      shooterMeta: participant(replay, shot.shooter, shot), victimMeta: participant(replay, event.victim, event) });
  }
  const paths = proposed.filter(path => { if (uses.get(path.id) === 1) return true; reject(path.hit, 'multiple_hits_for_shot'); return false; }).sort(ordered);
  const byShot = new Map(paths.map(path => [path.id, path])), byHit = new Map(paths.map(path => [path.hitSeq, path]));
  const volleys = [], groups = new Map();
  const finish = group => { if (group.shots.length >= 4) volleys.push({ ...group, count: group.shots.length,
    linked: group.shots.filter(seq => byShot.has(seq)).length,
    center: { x: group.x / group.shots.length, y: group.y / group.shots.length, z: group.z / group.shots.length } }); };
  for (const shot of shots) {
    const meta = metadataAt(replay.tracks.get(shot.shooter), shot.t, shot.seq);
    if (!meta) continue;
    const k = `${meta.team}:${meta.owner || 'team'}`, p = experimentalPose(shot.position);
    let group = groups.get(k);
    if (!group || shot.t - group.t > 700) {
      if (group) finish(group);
      group = { id: shot.seq, t: shot.t, seq: shot.seq, end: shot.t, team: meta.team,
        label: meta.owner ? `${replay.players.get(meta.owner)?.name || 'Player'} · squad` : `Team ${meta.team + 1} · ownership unknown`,
        shots: [], x: 0, y: 0, z: 0 };
      groups.set(k, group);
    }
    group.end = shot.t; group.shots.push(shot.seq); group.x += p.x; group.y += p.y; group.z += p.z;
  }
  for (const group of groups.values()) finish(group);
  volleys.sort(ordered);
  return { paths, byShot, byHit, linkedHits: paths.map(path => path.hit).sort(ordered), volleys, unresolved, reasons, stats: {
    shots: shots.length, hits: hits.length, eligibleHits, linked: paths.length, unlinkedShots: shots.length - paths.length,
    unresolvedHits: eligibleHits - paths.length, volleys: volleys.length,
  } };
}

export function pathPose(path, t) {
  const u = Math.max(0, Math.min(1, (t - path.t) / path.duration));
  return { x: path.from.x + (path.to.x - path.from.x) * u, y: path.from.y + (path.to.y - path.from.y) * u, z: path.from.z + (path.to.z - path.from.z) * u };
}

export function pathVisible(path, options = {}) { return matchesDisplay(path.shooterMeta, options); }

export function inferredFrame(combat, t, seq = Infinity, options = {}) {
  const rows = combat.paths, end = eventIndex(rows, t, seq), result = [], limit = options.density || 128;
  // Short flights make a bounded time scan sufficient, including after seeking.
  for (let i = end; i >= 0 && rows[i].t >= t - INFERENCE.windowMs - INFERENCE.lingerMs; i--) {
    const path = rows[i];
    if (t > path.end + INFERENCE.lingerMs || !pathVisible(path, options)) continue;
    const arrived = hasPassed(path.hit, t, seq);
    result.push({ path, position: pathPose(path, t), arrived, opacity: arrived ? Math.max(0, 1 - (t - path.end) / INFERENCE.lingerMs) : 1 });
    if (result.length >= limit) break;
  }
  return result;
}

export function combatTotalsAt(replay, combat, t, seq = Infinity) {
  const count = rows => eventIndex(rows || [], t, seq) + 1;
  return { shots: count(replay.byType.shot), hits: count(replay.byType.hit), deaths: count(replay.byType.death),
    linkedHits: count(combat.linkedHits) };
}

export function inferenceCsv(combat) {
  const fields = ['shot_seq', 'hit_seq', 'shooter_id', 'victim_id', 'shot_ms', 'hit_ms', 'range_m', 'flight_ms', 'heading_difference_deg', 'provenance'];
  return fields.join(',') + '\n' + combat.paths.map(path => [path.id, path.hitSeq, path.shooter, path.victim, path.t, path.end,
    path.range.toFixed(3), path.duration, path.headingError.toFixed(3), path.source].join(',')).join('\n') + '\n';
}
