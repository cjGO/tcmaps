// Display enrichment stays separate from the immutable recorder journal.
import { eventIndex, entityAt, experimentalPose, metadataAt } from './experimental-replay.js';
import roleCatalog from './experimental-replay-roles.js';
import { createMovementHistory } from './replay-history.js';

export const UNIT_TYPES = ['infantry', 'cavalry', 'artillery', 'unknown'];
export function resolveDisplayMetadata(replay, metadata) {
  const matched = replay.header.build?.components?.['scripts.txt'] === roleCatalog.scripts_sha256;
  return { players: replay.players, entities: metadata?.entities, troops: metadata?.troops, declaredRoles: matched ? roleCatalog.roles : {}, buildMatched: matched };
}
export function metadataTemplate(replay) {
  return { schema: 'warband-experimental-display', version: 1, recording_id: replay.header.id,
    build_id: replay.header.build.id ?? null, entities: Object.fromEntries([...replay.tracks.values()].filter(t => t.meta.kind === 'player').map(t => [t.id, { player_name: '' }])),
    troops: Object.fromEntries([...new Set([...replay.tracks.values()].flatMap(t => (t.changes || [t.meta]).filter(m => m.kind !== 'horse').map(m => m.troop)))].map(id => [id, {}])) };
}
export function parseDisplayMetadata(text, replay) {
  if (text.length > 1024 * 1024) throw new Error('Display metadata exceeds 1 MiB');
  const m = JSON.parse(text), object = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(m) || m.schema !== 'warband-experimental-display' || m.version !== 1 || m.recording_id !== replay.header.id || m.build_id !== (replay.header.build.id ?? null)) throw new Error('Display metadata must match this recording and build');
  const troops = new Set([...replay.tracks.values()].flatMap(t => (t.changes || [t.meta]).map(m => m.troop)));
  for (const [kind, rows] of [['entities', m.entities], ['troops', m.troops]]) {
    if (!object(rows) || Object.keys(rows).length > 4096) throw new Error('Invalid display metadata entries');
    for (const [id, row] of Object.entries(rows)) {
      if (!/^\d+$/.test(id) || !(kind === 'entities' ? replay.tracks : troops).has(Number(id)) || !object(row)) throw new Error(`Unknown ${kind} ID ${id}`);
      for (const [key, value] of Object.entries(row)) {
        if (key === 'unit_category' ? !UNIT_TYPES.includes(value) : !['player_name', 'squad'].includes(key) || typeof value !== 'string' || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid display field ${key}`);
        if (key === 'player_name' && (kind !== 'entities' || !(replay.tracks.get(Number(id)).changes || [replay.tracks.get(Number(id)).meta]).some(m => m.kind === 'player'))) throw new Error('Player names must identify a recorded player entity');
      }
    }
  }
  return m;
}
export function displayMeta(track, sample, metadata, t = sample?.t ?? track.birth.t, seq = sample?.seq ?? Infinity) {
  const raw = metadataAt(track, t, seq) || track.meta, troop = metadata?.troops?.[raw.troop], entity = metadata?.entities?.[track.id];
  const explicit = entity?.unit_category ?? troop?.unit_category ?? raw.unit_category ?? metadata?.declaredRoles?.[raw.troop];
  const category = UNIT_TYPES.includes(explicit) && explicit !== 'unknown' ? explicit : sample?.horse >= 0 ? 'cavalry' : 'unknown';
  return { ...raw, id: track.id, unit_category: category,
    player_name: entity?.player_name || (typeof raw.player_name === 'string' ? raw.player_name.slice(0, 128) : ''),
    squad: entity?.squad || troop?.squad || (raw.owner ? `${metadata?.players?.get(raw.owner)?.name || 'Player'} #${raw.owner}` : (typeof raw.squad === 'string' ? raw.squad.slice(0, 128) : '')),
    label: entity?.player_name || (typeof raw.player_name === 'string' && raw.player_name.slice(0, 128)) || `${raw.kind === 'player' ? 'Player' : raw.kind === 'horse' ? 'Horse' : 'Bot'} #${track.id}` };
}
export function matchesDisplay(meta, options = {}, types = options.unitTypes) {
  return (meta.kind === 'horse' ? options.horses !== false : meta.kind === 'player' ? options.players !== false : options.bots !== false) &&
    (!types || types.includes(meta.unit_category)) && (!options.soldier || meta.id === Number(options.soldier)) && (!options.squad || meta.squad === options.squad);
}
export function experimentalViewAt(track, t, seq = Infinity) {
  if (!track) return null;
  const live = entityAt(track, t, seq), p = live || track.samples[eventIndex(track.samples, t, seq)];
  return p ? { ...p, mounted: p.horse >= 0, holding: !live, ended: eventIndex([track.end], t, seq) >= 0 } : null;
}
export function experimentalDeaths(replay, metadata) {
  metadata = resolveDisplayMetadata(replay, metadata);
  return (replay.byType.death || []).flatMap(row => {
    const track = replay.tracks.get(row.id);
    if (metadataAt(track, row.t, row.seq)?.kind !== 'bot') return [];
    const sample = track.samples[eventIndex(track.samples, row.t, row.seq - 1)];
    const position = row.position ? experimentalPose(row.position) : sample;
    if (!position) return [];
    return [{ ...displayMeta(track, sample, metadata, row.t, row.seq), ...position, t: row.t, seq: row.seq, measured: !!row.position }];
  });
}
// Adapt only derived movement data for the existing history/heatmap algorithm.
// Native poses, event ordering and source metadata remain in the experimental model.
export function movementAdapter(replay, metadata, options = {}) {
  metadata = resolveDisplayMetadata(replay, metadata);
  const tracks = new Map();
  for (const track of replay.tracks.values()) {
    if (track.meta.kind === 'horse') continue;
    const samples = track.samples.map(p => ({ ...p, index: p.snapshot, mounted: p.horse >= 0 }));
    const observations = [...(track.changes || [track.meta]), ...samples].sort((a,b) => a.t - b.t || a.seq - b.seq);
    const changes = observations.map(p => {
      const sample = track.samples[eventIndex(track.samples, p.t, p.seq)];
      const meta = displayMeta(track, sample, metadata, p.t, p.seq);
      return { ...meta, t: p.t, seq: p.seq, owner: meta.owner ?? false };
    });
    // Keep time-varying squad filters while reusing the stable movement algorithm.
    if (options.squad) for (const meta of changes) if (meta.squad !== options.squad) meta.unit_category = 'filtered-out';
    tracks.set(track.id, { ...track, birth: track.birth.t, death: track.end.t, changes, samples });
  }
  return { tracks, first: replay.first, coverageEnd: replay.last, maxGap: 10000, header: { round_start_ms: replay.first } };
}
export function experimentalHistory(replay, data, metadata, options = {}) {
  const history = createMovementHistory(movementAdapter(replay, metadata, options), data, { ...options, squad: '', unitTypes: options.unitTypes || UNIT_TYPES });
  for (const segment of history.segments) {
    const rows = replay.tracks.get(segment.id).samples;
    segment.seq = rows[eventIndex(rows, segment.t)]?.seq ?? 0;
  }
  history.segments.sort((a, b) => a.t - b.t || a.seq - b.seq);
  history.completed = (t, seq = Infinity) => eventIndex(history.segments, t, seq) + 1;
  return history;
}
export function experimentalStrengthAt(replay, t, seq = Infinity) {
  const counts = new Map([[0, 0], [1, 0]]);
  for (const track of replay.tracks.values()) {
    const meta = metadataAt(track, t, seq);
    if (meta?.kind === 'bot' && eventIndex([track.end], t, seq) < 0) counts.set(meta.team, (counts.get(meta.team) || 0) + 1);
  }
  return counts;
}
