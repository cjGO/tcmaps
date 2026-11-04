import { readFile, readdir, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { COUNTERS, emptyTotals, addTotals } from '../src/player-stats.js';

function validateTotals(totals, partial = false) {
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) throw new Error('Invalid counters');
  for (const key of COUNTERS) {
    if (partial && totals[key] === undefined) continue;
    if (!Number.isSafeInteger(totals[key]) || totals[key] < 0) throw new Error('Invalid counter: ' + key);
  }
}
function validateSnapshot(snapshot) {
  if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.seq) || snapshot.seq < 0 || !snapshot.players || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.day)) throw new Error('Invalid snapshot');
  for (const [uid, p] of Object.entries(snapshot.players)) {
    if (!/^\d+$/.test(uid) || typeof p.name !== 'string') throw new Error('Invalid player');
    validateTotals(p.totals);
  }
  return snapshot;
}
export async function loadPlayerStats(directory, watch = () => {}) {
  const notes = [];
  let snapshot;
  for (const file of ['current.json', 'previous.json']) {
    const path = join(directory, 'snapshots', file); watch(path);
    try {
      snapshot = validateSnapshot(JSON.parse(await readFile(path, 'utf8')));
      if (file === 'previous.json') notes.push('The current snapshot is unavailable; recovered from the previous snapshot.');
      break;
    } catch (error) { if (error.code !== 'ENOENT') notes.push(`${file} could not be validated.`); }
  }
  const history = new Map(), days = new Set(), indexPath = join(directory, 'events', 'index.jsonl'); watch(indexPath);
  let seq = 0, firstAt = null, lastAt = null, historyValid = false, matchedSnapshot = !snapshot || snapshot.seq === 0;
  let roundResults = 0, ignoredFiles = 0;
  try {
    const index = (await readFile(indexPath, 'utf8')).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    if (!index.length) throw new Error('Empty journal index');
    const seen = new Set();
    for (const entry of index) {
      if (entry.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) || seen.has(entry.day)) throw new Error('Invalid journal index');
      seen.add(entry.day);
      const path = join(directory, 'events', entry.day + '.jsonl'); watch(path);
      const stream = createReadStream(path, { encoding: 'utf8' });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.version !== 1 || e.seq !== seq + 1 || !Number.isSafeInteger(e.at) || e.at < 0 || !e.changes || !['profile', 'kill', 'round_result'].includes(e.kind)) throw new Error('Invalid journal event or sequence gap');
          // Queued events can flush into the next day's file at midnight.
          const eventDay = new Date(e.at * 1000).toISOString().slice(0, 10);
          days.add(eventDay);
          seq = e.seq; firstAt = firstAt === null ? e.at : Math.min(firstAt, e.at); lastAt = Math.max(lastAt ?? 0, e.at);
          if (e.kind === 'round_result') roundResults++;
          for (const [uid, change] of Object.entries(e.changes)) {
            if (!/^\d+$/.test(uid) || typeof change.name !== 'string') throw new Error('Invalid journal player');
            validateTotals(change.delta, true);
            if (!history.has(uid)) history.set(uid, { name: change.name, aliases: new Set(), totals: emptyTotals(), days: new Map() });
            const p = history.get(uid); p.name = change.name; p.aliases.add(change.name);
            addTotals(p.totals, change.delta);
            if (!p.days.has(eventDay)) p.days.set(eventDay, emptyTotals());
            addTotals(p.days.get(eventDay), change.delta);
          }
          if (snapshot && seq === snapshot.seq) {
            matchedSnapshot = Object.keys(snapshot.players).length === history.size && Object.entries(snapshot.players).every(([uid, p]) =>
              history.has(uid) && COUNTERS.every(key => p.totals[key] === history.get(uid).totals[key]));
            if (!matchedSnapshot) throw new Error('Snapshot and journal totals differ');
          }
        }
      } finally { lines.close(); stream.destroy(); }
    }
    if (!matchedSnapshot || (snapshot && seq < snapshot.seq)) throw new Error('Journals do not cover the snapshot');
    historyValid = true;
    const files = await readdir(join(directory, 'events'));
    ignoredFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && !seen.has(f.slice(0, 10))).length;
  } catch (error) {
    if (snapshot) notes.push('Event history could not be reconciled. Showing snapshot totals only; date filters and trends are unavailable.');
    else notes.push('No validated player statistics are available. Add a valid snapshot or a complete indexed event journal to stats/.');
  }
  const source = historyValid ? [...history] : Object.entries(snapshot?.players || {});
  source.sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  const players = source.map(([uid, p], order) => ({
    id: createHash('sha256').update('maproom-player:' + uid).digest('hex').slice(0, 16),
    order, name: p.name, aliases: [...(p.aliases || [])].filter(n => n !== p.name),
    totals: COUNTERS.map(key => p.totals[key]),
    days: historyValid ? [...p.days].map(([day, values]) => [day, COUNTERS.map(key => values[key])]) : [],
  }));
  return { version: 1, players, meta: { historyValid, days: historyValid ? [...days].sort() : [], firstAt: historyValid ? firstAt : null,
    lastAt: historyValid ? lastAt : null, snapshotDay: snapshot?.day || null, seq: historyValid ? seq : snapshot?.seq || 0,
    roundResults: historyValid ? roundResults : null, ignoredFiles, notes } };
}

export function playerStatsPlugin() {
  let root;
  return {
    name: 'player-statistics',
    configResolved(config) { root = config.root; },
    resolveId(id) { if (id === 'virtual:player-stats') return '\0virtual:player-stats'; },
    async load(id) {
      if (id !== '\0virtual:player-stats') return;
      // Raw server logs are intentionally ignored by Git. A generated, compact
      // aggregate keeps source-based deployments populated without publishing logs.
      const sources = ['snapshots/current.json', 'snapshots/previous.json', 'events/index.jsonl'].map(file => join(root, 'stats', file));
      sources.forEach(path => this.addWatchFile(path));
      const present = await Promise.all(sources.map(path => access(path).then(() => true, () => false)));
      let data;
      if (present.some(Boolean)) data = await loadPlayerStats(join(root, 'stats'), path => this.addWatchFile(path));
      else {
        const aggregate = join(root, 'lib', 'player-stats.json'); this.addWatchFile(aggregate);
        try { data = JSON.parse(await readFile(aggregate, 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          data = await loadPlayerStats(join(root, 'stats'));
        }
      }
      return 'export default ' + JSON.stringify(data);
    },
  };
}
