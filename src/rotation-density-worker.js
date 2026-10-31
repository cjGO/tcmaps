import { densityFromRecordings } from './rotation-density-recordings.js';

self.onmessage = async ({ data: { recordings, terrain } }) => {
  const output = await densityFromRecordings(recordings, terrain, async recording => {
    const response = await fetch(recording.url);
    if (!response.ok) throw new Error('Replay could not load');
    return response.text();
  }, (progress, total) => self.postMessage({ progress, total }));
  const grids = [output.result, ...Object.values(output.result.comparison || {})];
  self.postMessage(output, grids.flatMap(grid => [grid.movement.buffer, grid.deaths.buffer]));
};
