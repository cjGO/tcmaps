import manifest from '../lib/rotation-topology.json';
import { replayVariantRegistry, recordingVariant } from './replay-variants.js';

const files = import.meta.glob('../maps/*/test_map_*/variants/*.placements.json', { eager: true, query: '?raw', import: 'default' });
export const replayAssets = replayVariantRegistry(manifest, files);

export async function replayVariantAssets(map) {
  return recordingVariant(map, (await replayAssets).variants);
}
