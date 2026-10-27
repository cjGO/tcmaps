import { readdir, readFile } from 'node:fs/promises';
import { parseJournal, sourceEqual } from '../src/tactical-replay.js';
import { botStrengthHistory, botStrengthAt } from '../src/replay-strength.js';

// Count each recorded connection once across spawns, ownership and control changes.
// Spectators are not recorded, and reconnects receive a new connection ID.
export function recordedPlayerRoster(replay) {
  const connections = new Map();
  for (const track of replay.tracks.values()) {
    for (const meta of track.changes) {
      for (const id of [meta.owner, meta.controller]) {
        if (Number.isSafeInteger(id) && id > 0 && !connections.has(id)) connections.set(id, new Set());
      }
      // A display name belongs to the controller, never to a different commander.
      if (connections.has(meta.controller) && typeof meta.player_name === 'string') connections.get(meta.controller).add(meta.player_name);
    }
  }
  return [...connections].sort(([a], [b]) => a - b).map(([id, names]) => ({ id, names: [...names].sort() }));
}

export function recordedPlayerCount(replay) {
  return recordedPlayerRoster(replay).length;
}

// Keep recordings as separate assets so opening the app never downloads every round.
export async function replayCatalog(directory) {
  const registry = JSON.parse(await readFile(new URL('../lib/editor-rotation.json', import.meta.url), 'utf8'));
  const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return Promise.all(files.filter(name => name.endsWith('.replay.json')).sort().reverse().map(async filename => {
    const bundle = JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
    const replay = parseJournal(bundle.journal), { header, end } = replay;
    // Scene slots can be reassigned; require an exact source match.
    const matches = registry.filter(row => sourceEqual(row.source, header.map.source));
    const mapIds = new Set(matches.map(row => row.map_id).filter(Boolean));
    const history = botStrengthHistory(replay);
    const counts = botStrengthAt(history, replay.coverageEnd);
    const roster = recordedPlayerRoster(replay);
    return { filename, id: header.id, map: header.map.id,
      map_id: mapIds.size === 1 ? [...mapIds][0] : null,
      round: /^\d+:(\d+):\d+$/.exec(header.round_id)?.[1] || null,
      players: roster.length, roster,
      bots: counts.reduce((sum, count) => sum + count, 0),
      bots_by_team: history.teams.map((team, i) => ({ team, count: counts[i] })),
      round_ended: end?.complete === true && end.reason === 'round_end', created: header.created_utc, synthetic: header.synthetic,
      url: `replays/${encodeURIComponent(filename)}` };
  })).then(rows => rows.sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || b.id.localeCompare(a.id)));
}

export function replaysPlugin() {
  let root, catalog;
  return {
    name: 'replay-catalog',
    configResolved(config) { root = new URL('./replays/', `file://${config.root}/`); },
    resolveId(id) { if (id === 'virtual:replays') return '\0virtual:replays'; },
    async load(id) {
      if (id !== '\0virtual:replays') return;
      catalog = await replayCatalog(root);
      return `export default ${JSON.stringify(catalog)}`;
    },
    async generateBundle() {
      for (const replay of catalog || await replayCatalog(root)) {
        this.emitFile({ type: 'asset', fileName: `replays/${replay.filename}`, source: await readFile(new URL(replay.filename, root)) });
      }
    },
  };
}
