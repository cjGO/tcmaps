import { includedVariants, variantId, assertVariantSource } from './map-variants.js';

const sourceEqual = (a, b) => !!a && !!b && ['sco_sha256', 'recipe_sha256', 'terrain_code'].every(k => a[k] === b[k]);
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');

// Keep the measured terrain provenance; compiled variants are overlays unless
// the recording independently matches that measured source.
export async function replayVariantRegistry(manifest, files) {
  const documents = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, JSON.parse(text)]));
  const variants = [];
  for (const terrain of manifest.maps) {
    for (const variant of includedVariants(documents, terrain.map_id)) {
      assertVariantSource(variant.document, terrain);
      const path = Object.keys(files).find(path => path.endsWith(`/${terrain.map_id}/variants/${variant.filename}`));
      variants.push({ ...variant, map_id: terrain.map_id, revision: await digest(files[path]) });
    }
  }
  const maps = [...manifest.maps, ...variants.map(variant => {
    const terrain = manifest.maps.find(entry => entry.map_id === variant.map_id);
    return { ...terrain, variant_id: variant.filename, variant_revision: variant.revision };
  })];
  return { manifest: { ...manifest, maps, map_count: maps.length }, variants };
}

export function recordingVariant(map, variants) {
  if (map?.available === false || map?.kind === 'generated' || !/^test_map_\d+$/.test(map?.map_id)) return null;
  const id = variantId(map.variant_id || map.variant_filename || map.map_name, map.map_id);
  if (id === 'source') return null;
  const matches = variants.filter(variant => variant.map_id === map.map_id && variant.id === id &&
    (map.variant_revision ? variant.revision === map.variant_revision : sourceEqual(map.source, variant.document.source)));
  return matches.length === 1 ? matches[0] : null;
}
