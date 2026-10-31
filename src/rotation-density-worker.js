import { parseJournal } from './tactical-replay.js';
import { parseExperimentalJournal } from './experimental-replay.js';
import { createDensity, accumulateDensity, densityTerrainMatch } from './rotation-density.js';

self.onmessage = async ({ data: { recordings, terrain, olderVersions } }) => {
  const result = createDensity(terrain), used = new Set();
  let skipped = 0, failed = 0;
  let processed = 0;
  for (const recording of recordings) {
    try {
      const response = await fetch(recording.url);
      if (!response.ok) throw new Error('Replay could not load');
      const input = await response.text();
      const experimental = recording.version === 2;
      let journal = input;
      if (!experimental && recording.filename.endsWith('.replay.json')) journal = JSON.parse(input).journal;
      const header = JSON.parse(journal.slice(0, journal.indexOf('\n')));
      if (!densityTerrainMatch(header, terrain, olderVersions)) { skipped++; self.postMessage({ progress: ++processed, total: recordings.length }); continue; }
      const replay = experimental ? parseExperimentalJournal(journal) : parseJournal(journal);
      if (used.has(replay.header.id)) continue;
      used.add(replay.header.id);
      if (!accumulateDensity(result, replay, terrain, experimental, olderVersions)) skipped++;
    } catch { failed++; }
    self.postMessage({ progress: ++processed, total: recordings.length });
  }
  self.postMessage({ result, skipped, failed }, [result.movement.buffer, result.deaths.buffer]);
};
