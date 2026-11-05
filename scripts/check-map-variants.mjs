import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readVariantFiles } from './sync-map-variants.mjs';
import { includedVariants } from '../src/map-variants.js';
import { assertPlacementSource, resolveVariantPreview } from '../src/rotation-variants.js';
import { placementTransform } from '../src/editor-spatial.js';

const root = new URL('../', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const files = Object.fromEntries(Object.entries(await readVariantFiles(fileURLToPath(new URL('maps', root)))).map(([file, raw]) => ['maps/' + file, raw]));
const current = await json('lib/rotation-topology.json'), archived = await json('lib/replay-topology.json');
const models = await json('lib/editor-models.json');
const { assets } = await json('public' + models.manifest_url);
let count = 0, placements = 0;
for (const map of current.maps) {
  const variants = includedVariants(files, map.map_id);
  assert.equal(new Set(variants.map(variant => variant.id)).size, variants.length, `Conflicting filename aliases for ${map.map_id}`);
  for (const variant of variants) {
    const preview = await resolveVariantPreview(variant, map, archived.maps);
    assert.ok(preview, `No verified terrain for ${variant.path}`);
    const data = await json('public' + preview.terrain.url);
    assertPlacementSource(variant.document, data, preview);
    for (const point of variant.document.placements) {
      assert.ok(assets[point.asset], `Missing asset ${point.asset} in ${variant.path}`);
      placementTransform(data, point, assets[point.asset]);
    }
    count++; placements += variant.document.placements.length;
  }
}
console.log(`Verified ${count} rotation variants with ${placements} placed assets against measured terrain and model definitions.`);
