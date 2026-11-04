import { defineConfig } from 'vite';
import { replaysPlugin } from './scripts/replay-catalog.mjs';
import { playerActivityPlugin } from './scripts/player-activity.mjs';
import { playerStatsPlugin } from './scripts/player-stats.mjs';
export default defineConfig({ plugins: [replaysPlugin(), playerActivityPlugin(), playerStatsPlugin()] });
