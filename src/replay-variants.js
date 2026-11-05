import { includedVariants, variantId } from './map-variants.js';

const sourceEqual = (a, b) => !!a && !!b && ['sco_sha256', 'recipe_sha256', 'terrain_code'].every(k => !!a[k] && a[k] === b[k]);
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
      const revision = await digest(files[variant.path]);
      if (!sourceEqual(variant.document.source, terrain.source) && revision !== terrain.variant_revision) continue;
      if (!variants.some(entry => entry.map_id === terrain.map_id && entry.filename === variant.filename && entry.revision === revision)) {
        variants.push({ ...variant, map_id: terrain.map_id, revision,
          registrations: manifest.maps.filter(row => row.map_id === terrain.map_id && row.variant_revision === revision) });
      }
      if (sourceEqual(variant.document.source, terrain.source)) overlays.push({ ...terrain, variant_id: variant.filename, variant_revision: revision, placement_overlay: true, exact_only: false });
    }
  }
  const maps = [...manifest.maps, ...overlays];
  return { manifest: { ...manifest, maps, map_count: maps.length }, variants };
}

export function recordingVariant(map, variants) {
  return inferRecordingVariant(map, variants).variant;
}

export function replayMapIdentity(map, entries) {
  if (!map || map.available === false || map.kind === 'generated' || /^test_map_\d+$/.test(map.map_id)) return map;
  const ids = [...new Set(entries.filter(row => sourceEqual(row.source, map.source)).map(row => row.map_id).filter(Boolean))];
  return ids.length === 1 ? { ...map, map_id: ids[0] } : map;
}

export function inferRecordingVariant(map, variants) {
  const none = { variant: null, reason: 'Variant could not be inferred; choose a map variant below.' };
  if (map?.available === false || map?.kind === 'generated' || !/^test_map_\d+$/.test(map?.map_id)) return none;
  const name = map.variant_id || map.variant_filename || (typeof map.map_name === 'string' && map.map_name.startsWith(`${map.map_id}_`) ? map.map_name : '');
  const id = name ? variantId(name, map.map_id) : null;
  if (id === 'source') return { variant: null, reason: 'Recording specifies Source / RAW.' };
  const family = variants.filter(v => v.map_id === map.map_id && (!id || v.id === id));
  const unique = matches => [...new Map(matches.map(v => [v.revision, v])).values()];
  const result = (matches, reason) => {
    const choices = unique(matches);
    return choices.length === 1 ? { variant: choices[0], reason } : none;
  };
  if (map.variant_revision) return result(variants.filter(v => v.map_id === map.map_id && v.revision === map.variant_revision), 'Recorded variant checksum matched.');
  const installed = family.filter(v => v.registrations?.some(row => sourceEqual(row.source, map.source)));
  if (installed.length) return result(installed, 'Inferred from the recorded map source and installed variant.');
  if (id) return result(family, 'Inferred from the recorded variant name; revision unverified.');
  return none;
}

export function replayPlacementDocument(variant, data, manual = false) {
  if (!variant) return null;
  const compatible = sourceEqual(variant.document.source, data.source) ||
    variant.registrations?.some(row => sourceEqual(row.source, data.source));
  if (!compatible && !manual) throw new Error('Variant terrain differs. Select a variant manually to preview an unverified overlay.');
  return { ...variant.document, source: data.source };
}
