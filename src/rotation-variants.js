import { assertVariantSource, variantId } from './map-variants.js';

const sourceMatches = (document, terrain) => {
  try { assertVariantSource(document, terrain); return true; } catch { return false; }
};
const revision = async raw => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(v => v.toString(16).padStart(2, '0')).join('');

// A compiled installed scene has different SCO/recipe hashes from its input
// loadout. Its saved JSON checksum proves which placements were built into it.
export async function resolveVariantPreview(variant, installed, archived = []) {
  if (!variant || !installed || variant.map_id !== installed.map_id) return null;
  const checksum = variant.raw === null || variant.raw === undefined ? null : await revision(variant.raw);
  const registered = checksum && [installed, ...archived].find(row =>
    row.map_id === variant.map_id && row.variant_revision === checksum);
  if (registered) {
    return { variant, terrain: registered, registration: registered, revision: checksum };
  }
  const terrain = [installed, ...archived].find(row => row.map_id === variant.map_id && sourceMatches(variant.document, row));
  return terrain ? { variant, terrain, registration: null, revision: checksum } : null;
}

export async function installedVariantPreview(variants, installed) {
  if (!installed?.variant_revision) return null;
  for (const variant of variants) {
    const preview = await resolveVariantPreview(variant, installed);
    if (preview?.registration) return preview;
  }
  return null;
}

// RAW is a separate registered scene, not the installed variant without assets.
export function sourceTerrain(installed, archived = []) {
  if (variantId(installed.variant_id, installed.map_id) === 'source') return installed;
  const candidates = archived.filter(row => row.map_id === installed.map_id && variantId(row.variant_id, row.map_id) === 'source');
  const unique = [...new Map(candidates.map(row => [row.sha256 || row.url, row])).values()];
  if (unique.length !== 1) throw new Error('Source / RAW terrain and original spawns are unavailable or ambiguous for this map');
  return unique[0];
}

export function assertPlacementSource(document, terrain, { registration, revision } = {}) {
  if (registration && revision && revision === registration.variant_revision) {
    assertVariantSource({ source: registration.source }, terrain);
  } else assertVariantSource(document, terrain);
}
