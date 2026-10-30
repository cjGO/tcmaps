import { readFile } from 'node:fs/promises';
import { csvRows } from '../src/map-identity.js';
import { dailyUniquePlayers, weeklyUniquePlayers } from '../src/player-activity.js';

export function playerActivityPlugin() {
  let root;
  return {
    name: 'daily-unique-players',
    configResolved(config) { root = config.root; },
    resolveId(id) { if (id === 'virtual:daily-players') return '\0virtual:daily-players'; },
    async load(id) {
      if (id !== '\0virtual:daily-players') return;
      const path = root + '/player_activity.csv';
      this.addWatchFile(path);
      const text = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      const [headers = [], ...rows] = csvRows(text);
      // Publish aggregate totals only; account IDs and player names stay out of assets.
      return 'export const weeklyPlayers = ' + JSON.stringify(weeklyUniquePlayers(headers, rows)) + ';\n'
        + 'export default ' + JSON.stringify(dailyUniquePlayers(headers, rows));
    },
  };
}
