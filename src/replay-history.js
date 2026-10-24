import { upperIndex } from './tactical-replay.js';

// Squad ownership is scoped to a team; connection IDs are local pseudonyms.
export const squadKey = meta => `${meta.team}:${meta.owner === false ? 'unassigned' : meta.owner}`;
export function matchesHistory(meta, id, { players = true, bots = true, squad = '', soldier = '' } = {}) {
  return (meta.kind === 'player' ? players : bots) && (!squad || squadKey(meta) === squad) && (!soldier || id === Number(soldier));
}
const point = (a, b, t) => {
  const u = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
};

export function createMovementHistory(replay, data, filters = {}, cell = 10) {
  const segments = [], tracks = [], cells = new Map(), bounds = data.bounds;
  let work = 0;
  for (const track of replay.tracks.values()) {
    const rows = [];
    for (let i = 0; i + 1 < track.samples.length; i++) {
      const a = track.samples[i], b = track.samples[i + 1];
      if (b.t - a.t > replay.maxGap || b.index !== a.index + 1) continue;
      const stop = Math.min(b.t, track.death, replay.coverageEnd);
      if (stop <= a.t) continue;
      const cuts = [a.t, ...track.changes.filter(m => m.t > a.t && m.t < stop).map(m => m.t), stop];
      for (let j = 0; j + 1 < cuts.length; j++) {
        const start = cuts[j], end = cuts[j + 1], meta = track.changes[upperIndex(track.changes, start)];
        if (!matchesHistory(meta, track.id, filters)) continue;
        const from = point(a, b, start), to = point(a, b, end);
        const segment = { t: end, start, from, to, team: meta.team, id: track.id };
        segments.push(segment); rows.push({ ...segment, t: start, end });
        const steps = Math.max(1, Math.min(1000, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (cell / 2))));
        if ((work += steps) > 4000000) throw new Error('Movement history work limit exceeded; select a squad or soldier.');
        for (let k = 0; k < steps; k++) {
          const begin = start + (end - start) * k / steps, finish = start + (end - start) * (k + 1) / steps;
          const p = point(a, b, (begin + finish) / 2);
          if (p.x < bounds.x_min_m || p.x >= bounds.x_max_m || p.y < bounds.y_min_m || p.y >= bounds.y_max_m) continue;
          const ix = Math.floor((p.x - bounds.x_min_m) / cell), iy = Math.floor((p.y - bounds.y_min_m) / cell), key = `${ix},${iy}`;
          let row = cells.get(key);
          if (!row) { row = { ix, iy, events: [] }; cells.set(key, row); }
          row.events.push({ t: begin, delta: 1 }, { t: finish, delta: -1 });
        }
      }
    }
    if (rows.length) tracks.push(rows);
  }
  segments.sort((a, b) => a.t - b.t);
  for (const row of cells.values()) {
    row.events.sort((a, b) => a.t - b.t);
    // Soldiers often share sample times; retain one rate change per timestamp.
    const merged = [];
    for (const event of row.events) {
      if (merged.at(-1)?.t === event.t) merged.at(-1).delta += event.delta;
      else merged.push(event);
    }
    row.events = merged;
    let previous = row.events[0].t, seconds = 0, rate = 0;
    for (const event of row.events) {
      seconds += rate * (event.t - previous) / 1000; rate += event.delta;
      Object.assign(event, { seconds, rate }); previous = event.t;
    }
  }
  return { segments, cells: [...cells.values()], cell,
    completed(t) { return upperIndex(segments, t) + 1; },
    partial(t) {
      const result = [];
      for (const rows of tracks) {
        const row = rows[upperIndex(rows, t)];
        if (!row || t <= row.start || t >= row.end) continue;
        result.push({ ...row, to: point({ ...row.from, t: row.start }, { ...row.to, t: row.end }, t) });
      }
      return result;
    },
    heatAt(t) {
      return [...cells.values()].map(row => {
        const event = row.events[upperIndex(row.events, t)];
        return event ? Math.max(0, event.seconds + event.rate * (t - event.t) / 1000) : 0;
      });
    }
  };
}

// A death event has no position of its own. Keep the final observed position,
// even when old, rather than extrapolating movement after the last snapshot.
export function botDeathMarkers(replay) {
  const markers = [];
  for (const track of replay.tracks.values()) {
    if (track.removalReason !== 'death' || !Number.isFinite(track.death)) continue;
    const sample = track.samples[upperIndex(track.samples, track.death)];
    const meta = track.changes[upperIndex(track.changes, track.death)];
    if (!sample || meta?.kind !== 'bot') continue;
    markers.push({ ...sample, ...meta, id: track.id, t: track.death,
      sampleTime: sample.t, ageMs: track.death - sample.t });
  }
  return markers.sort((a, b) => a.t - b.t);
}
