import { defineConfig } from 'vite';
import { replaysPlugin } from './scripts/replay-catalog.mjs';
export default defineConfig({ plugins: [replaysPlugin()] });
