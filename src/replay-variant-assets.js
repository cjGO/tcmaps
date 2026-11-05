import manifest from '../lib/rotation-topology.json';
import archived from '../lib/replay-topology.json';
import archivedFiles from '../lib/replay-variant-archive.json';
import { replayVariantRegistry, recordingVariant, replayTerrainManifest, replayMapIdentity } from './replay-variants.js';

const files = import.meta.glob(['../maps/*/test_map_*/variants/*.json', '../maps/*/test_map_*/variants/*.placements'], { eager: true, query: '?raw', import: 'default' });
export const replayAssets = replayVariantRegistry(replayTerrainManifest(manifest, archived), { ...files, ...archivedFiles });

export async function replayVariantAssets(map) {
  const assets = await replayAssets;
  return recordingVariant(replayMapIdentity(map, assets.manifest.maps), assets.variants);
}
