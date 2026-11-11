import { readdir, readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseExperimentalJournal } from '../src/experimental-replay.js';
import { experimentalStrengthAt } from '../src/experimental-replay-presentation.js';
import { parseJournal, sourceEqual } from '../src/tactical-replay.js';
import { recordedVariantId } from '../src/map-variants.js';
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

// Full journals expand into many track/snapshot objects. Keep only one input
// per directory in memory while preparing the small browser catalogue.
async function catalogRows(filenames, readRow) {
  const rows = [];
  for (const filename of filenames) rows.push(await readRow(filename));
  return rows;
}

// Keep recordings as separate assets so opening the app never downloads every round.
export async function replayCatalog(directory) {
  const registry = JSON.parse(await readFile(new URL('../lib/editor-rotation.json', import.meta.url), 'utf8'));
  const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return catalogRows(files.filter(name => name.endsWith('.replay.json') || name.endsWith('.jsonl')).sort().reverse(), async filename => {
    const content = await readFile(new URL(filename, directory), 'utf8');
    if (filename.endsWith('.jsonl') && JSON.parse(content.split('\n', 1)[0]).schema === 'warband-experimental-replay') {
      return experimentalCatalogRow(parseExperimentalJournal(content), filename, 'replays');
    }
    const replay = parseJournal(filename.endsWith('.jsonl') ? content : JSON.parse(content).journal), { header, end } = replay;
    // Scene slots can be reassigned; require an exact source match.
    const matches = registry.filter(row => sourceEqual(row.source, header.map.source));
    const mapIds = new Set(matches.map(row => row.map_id).filter(Boolean));
    const history = botStrengthHistory(replay);
    const counts = botStrengthAt(history, replay.coverageEnd);
    const roster = recordedPlayerRoster(replay);
    const mapId = /^test_map_\d+$/.test(header.map.map_id) ? header.map.map_id : mapIds.size === 1 ? [...mapIds][0] : null;
    return { version: 1, filename, id: header.id, map: header.map.id,
      map_id: mapId, variant_id: recordedVariantId(header.map, mapId),
      round: /^\d+:(\d+):\d+$/.exec(header.round_id)?.[1] || null,
      players: roster.length, roster,
      bots: counts.reduce((sum, count) => sum + count, 0),
      bots_by_team: history.teams.map((team, i) => ({ team, count: counts[i] })),
      round_ended: end?.complete === true && end.reason === 'round_end', created: header.created_utc, synthetic: header.synthetic,
      url: `replays/${encodeURIComponent(filename)}` };
  }).then(rows => rows.sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || b.id.localeCompare(a.id)));
}

export async function experimentalReplayCatalog(directory) {
  const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return catalogRows(files.filter(name => name.endsWith('.jsonl')), async filename => {
    const replay = parseExperimentalJournal(await readFile(new URL(filename, directory), 'utf8'));
    return experimentalCatalogRow(replay, filename, 'experimental_replays');
  });
}

function experimentalCatalogRow(replay, filename, folder) {
  const { header, terminal } = replay;
  const roster = recordedPlayerRoster(replay);
  for (const player of roster) {
    const name = replay.players.get(player.id)?.name;
    if (typeof name === 'string' && !player.names.includes(name)) player.names.push(name);
  }
  const counts = experimentalStrengthAt(replay, replay.last);
  return { version: 2, filename, id: header.id, map: header.map.id || `scene_${header.map.scene ?? 'unknown'}`,
    map_id: header.map.map_id || null, variant_id: recordedVariantId(header.map), round: null,
    players: roster.length, roster,
    bots: [...counts.values()].reduce((sum, count) => sum + count, 0),
    bots_by_team: [...counts].map(([team, count]) => ({ team, count })),
    round_ended: terminal?.complete === true && terminal.reason === 'round_end',
    created: header.created_utc, synthetic: header.synthetic,
    url: `${folder}/${encodeURIComponent(filename)}` };
}

export async function combinedReplayCatalog(directory) {
  const [v1, v2] = await Promise.all([replayCatalog(directory), experimentalReplayCatalog(new URL('../experimental_replays/', directory))]);
  return [...v1, ...v2].sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || b.id.localeCompare(a.id));
}

export function replaysPlugin() {
  let root, catalog, pending, worker, dev = false;
  function loadCatalog() {
    return pending ??= (dev ? new Promise((resolve, reject) => {
      // Parsing thousands of journals must not block serving the editor, CSS,
      // models, or HMR while a replay tab requests its catalogue.
      const task = worker = new Worker(new URL('./replay-catalog-worker.mjs', import.meta.url), { workerData: root.href });
      task.once('message', resolve);
      task.once('error', reject);
      task.once('exit', code => {
        if (worker === task) worker = null;
        // Ignored after a successful message; rejects if the server closes it early.
        reject(new Error(`Replay catalog worker exited (${code}).`));
      });
    }) : combinedReplayCatalog(root)).then(rows => catalog = rows).catch(error => { pending = null; throw error; });
  }
  return {
    name: 'replay-catalog',
    configResolved(config) { root = pathToFileURL(resolve(config.root, 'replays') + '/'); dev = config.command === 'serve'; },
    configureServer(server) { server.httpServer?.once('close', () => worker?.terminate()); },
    closeBundle() { return worker?.terminate(); },
    resolveId(id) { if (id === 'virtual:replays') return '\0virtual:replays'; },
    async load(id) {
      if (id !== '\0virtual:replays') return;
      catalog = await loadCatalog();
      return `export default ${JSON.stringify(catalog)}`;
    },
    async generateBundle() {
      for (const replay of catalog || await loadCatalog()) {
        this.emitFile({ type: 'asset', fileName: decodeURIComponent(replay.url), source: await readFile(new URL('../' + replay.url, root)) });
      }
    },
  };
}
