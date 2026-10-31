import { recordedVariantId } from './map-variants.js';
import { parseJournal } from './tactical-replay.js';
import { parseExperimentalJournal } from './experimental-replay.js';
import { createDensity, accumulateDensity, densityTerrainMatch, densityRecordingMatches } from './rotation-density.js';

export async function densityFromRecordings(recordings, terrain, loadText, progress = () => {}) {
  const result = createDensity(terrain), used = new Set();
  if (terrain.comparisonVariant) result.comparison = { source: createDensity(terrain), target: createDensity(terrain) };
  let skipped = 0, failed = 0, processed = 0;
  for (const recording of recordings) {
    try {
      if (!densityRecordingMatches(recording, terrain)) { skipped++; continue; }
      const input = await loadText(recording);
      const experimental = recording.version === 2;
      const journal = !experimental && recording.filename.endsWith('.replay.json') ? JSON.parse(input).journal : input;
      const header = JSON.parse(journal.split('\n', 1)[0]);
      // Legacy recordings use the same map link as the rotation's replay list.
      const linkedMapId = recording.map_id || terrain.map_id;
      if (!densityTerrainMatch(header, terrain, linkedMapId)) { skipped++; continue; }
      const replay = experimental ? parseExperimentalJournal(journal) : parseJournal(journal);
      if (used.has(replay.header.id)) continue;
      used.add(replay.header.id);
      if (!accumulateDensity(result, replay, terrain, experimental, linkedMapId)) skipped++;
      else if (result.comparison) {
        const variant = recordedVariantId(header.map, terrain.map_id);
        const group = variant === 'source' ? result.comparison.source : result.comparison.target;
        accumulateDensity(group, replay, terrain, experimental, linkedMapId);
      }
    } catch { failed++; }
    finally { progress(++processed, recordings.length); }
  }
  return { result, skipped, failed };
}
