import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { csvRows } from '../src/map-identity.js';

export function summarizeMerit(csv) {
  const [headers = [], ...rows] = csvRows(csv);
  const [timestamp, sourceId, targetId, points, sourceName, targetName] = [
    'timestamp_utc', 'player_source_id', 'player_target_id', 'points', 'player_source_name', 'player_target_name',
  ].map(name => headers.indexOf(name));
  const players = new Map();

  function recordPlayer(id, name, seenAt) {
    id = id?.trim();
    if (!id) return;
    if (!players.has(id)) players.set(id, { name: '', seenAt: -Infinity, hundredths: 0 });
    const player = players.get(id);
    if (name?.trim() && seenAt >= player.seenAt) {
      player.name = name.trim();
      player.seenAt = seenAt;
    }
    return player;
  }

  for (const row of rows) {
    const seenAt = Date.parse(row[timestamp]);
    const amount = Number(row[points]);
    if (!Number.isFinite(seenAt) || !row[points]?.trim() || !Number.isFinite(amount)) continue;
    recordPlayer(row[sourceId], row[sourceName], seenAt);
    const recipient = recordPlayer(row[targetId], row[targetName], seenAt);
    if (recipient) recipient.hundredths += Math.round(amount * 100);
  }

  return [...players.values()]
    .filter(player => player.name)
    .sort((a, b) => b.hundredths - a.hundredths || a.name.localeCompare(b.name, 'en'))
    .map(({ name, hundredths }) => ({ name, score: hundredths / 100 }));
}

export function playerMeritPlugin() {
  const moduleId = 'virtual:player-merit';
  const resolvedId = '\0' + moduleId;
  let path;
  return {
    name: 'player-merit',
    configResolved(config) { path = join(config.root, 'merit.csv'); },
    resolveId(id) { if (id === moduleId) return resolvedId; },
    async load(id) {
      if (id !== resolvedId) return;
      this.addWatchFile(path);
      const csv = await readFile(path, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      return 'export default ' + JSON.stringify(summarizeMerit(csv));
    },
  };
}
