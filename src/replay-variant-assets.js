import manifest from '../lib/rotation-topology.json';
import archived from '../lib/replay-topology.json';
import archivedFiles from '../lib/replay-variant-archive.json';
import { replayVariantRegistry, recordingVariant, replayTerrainManifest } from './replay-variants.js';

const files = import.meta.glob('../maps/*/test_map_*/variants/*.placements.json', { eager: true, query: '?raw', import: 'default' });
export const replayAssets = replayVariantRegistry(replayTerrainManifest(manifest, archived), { ...files, ...archivedFiles });

export async function replayVariantAssets(map) {
  return recordingVariant(map, (await replayAssets).variants);
}
