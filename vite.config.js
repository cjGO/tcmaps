import { defineConfig } from 'vite';
import { replaysPlugin } from './scripts/replay-catalog.mjs';
import { playerActivityPlugin } from './scripts/player-activity.mjs';
import { playerStatsPlugin } from './scripts/player-stats.mjs';
export default defineConfig({
  // Generated standalone editors contain embedded map data. Vite's default HTML
  // crawl also finds those ignored project archives and exhausts the Node heap.
  // Only the website entry needs dependency discovery; its imports are followed.
  optimizeDeps: { entries: ['index.html'] },
  plugins: [replaysPlugin(), playerActivityPlugin(), playerStatsPlugin()],
});
