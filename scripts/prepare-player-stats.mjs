import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadPlayerStats } from './player-stats.mjs';

const data = await loadPlayerStats(fileURLToPath(new URL('../stats/', import.meta.url)));
if (!data.players.length) throw new Error('No validated player data; the existing aggregate has been preserved.');
await writeFile(new URL('../lib/player-stats.json', import.meta.url), JSON.stringify(data) + '\n');
console.log(`Prepared ${data.players.length} player profiles through event ${data.meta.seq}. Raw journals and account IDs are excluded.`);
