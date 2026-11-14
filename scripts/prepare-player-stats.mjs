import { access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadPlayerStats } from './player-stats.mjs';

const directory = new URL('../stats/', import.meta.url);
if (process.argv.includes('--if-present')) {
  const present = await Promise.all(['snapshots/current.json', 'snapshots/previous.json', 'events/index.jsonl']
    .map(file => access(new URL(file, directory)).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })));
  if (!present.some(Boolean)) {
    console.log('No raw player statistics export; keeping the committed aggregate.');
    process.exit(0);
  }
}
const data = await loadPlayerStats(fileURLToPath(directory));
if (!data.players.length) throw new Error('No validated player data; the existing aggregate has been preserved.');
await writeFile(new URL('../lib/player-stats.json', import.meta.url), JSON.stringify(data) + '\n');
console.log(`Prepared ${data.players.length} player profiles through event ${data.meta.seq}. Raw journals and account IDs are excluded.`);
for (const note of data.meta.notes) console.warn(`Player statistics: ${note}`);
