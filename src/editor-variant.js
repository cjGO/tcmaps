import { resolveVariantPreview } from './rotation-variants.js';
import { assertVariantSource } from './map-variants.js';

// Installed loadouts describe the input scene, while editor projects describe
// the compiled scene. Only the registered file checksum authorizes that rebase.
export async function editorVariantDocument(variant, registration, project) {
  const document = variant.raw == null ? structuredClone(variant.document) : JSON.parse(variant.raw);
  const preview = await resolveVariantPreview({ ...variant, document }, registration);
  if (!preview) throw new Error('This placement file belongs to a different map or source version.');
  assertVariantSource({ source: registration.source }, project);
  document.source = structuredClone(project.source);
  if (preview.registration && document.version === 3) {
    document.default_spawn_points = structuredClone(project.default_spawn_points);
  }
  return document;
}
