import { includedVariants, variantId } from './map-variants.js';

const sourceEqual = (a, b) => !!a && !!b && ['sco_sha256', 'recipe_sha256', 'terrain_code'].every(k => a[k] === b[k]);
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');

export function replayTerrainManifest(current, archived) {
  const archivedFamilies = new Set(archived.maps.map(map => map.map_id));
  // Keep historical fallback choices stable; fresh terrain remains available
  // for recordings whose source matches exactly.
  const fresh = current.maps.map(map => ({ ...map, exact_only: archivedFamilies.has(map.map_id) }));
  const maps = [...new Map([...fresh, ...archived.maps].map(map => [map.sha256, map])).values()];
  return { ...current, maps, map_count: maps.length };
}

// Keep the measured terrain provenance; compiled variants are overlays unless
// the recording independently matches that measured source.
export async function replayVariantRegistry(manifest, files) {
  const variants = [];
  const overlays = [];
  for (const terrain of manifest.maps) {
    for (const variant of includedVariants(files, terrain.map_id)) {
      if (!sourceEqual(variant.document.source, terrain.source)) continue;
      const revision = await digest(files[variant.path]);
      if (!variants.some(entry => entry.map_id === terrain.map_id && entry.filename === variant.filename && entry.revision === revision)) {
        variants.push({ ...variant, map_id: terrain.map_id, revision });
      }
      overlays.push({ ...terrain, variant_id: variant.filename, variant_revision: revision, placement_overlay: true, exact_only: false });
    }
  }
  const maps = [...manifest.maps, ...overlays];
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
