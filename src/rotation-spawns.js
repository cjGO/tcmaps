import { groundHeight } from './editor-spatial.js';

const coordinates = points => points.map(p => `Team ${p.team + 1}: (${p.x_m.toFixed(3)}, ${p.y_m.toFixed(3)}) m`).join(' · ');

// Resolve once before creating the viewer so markers, team cameras and the
// explorer all start with the same spawn set, independently of asset loading.
export function rotationSpawns(data, preview, terrain, sourceSelected = false) {
  const document = preview?.variant.document;
  const edited = document?.version === 3 && document.spawn_points?.length === 2;
  const spawns = edited
    ? document.spawn_points.map(point => ({ ...point, z_m: groundHeight(data, point.x_m, point.y_m) }))
    : data.spawns.map(point => ({ ...point }));
  const origin = sourceSelected ? 'Source / RAW original spawns'
    : edited ? `Variant spawns · ${preview.variant.label}`
    : `Measured scene spawns · ${terrain.variant_id || 'Source / RAW'}`;
  let note = `Displayed spawns: ${origin}. ${coordinates(spawns)}. Blue = Team 1; red = Team 2. Coordinates are X, Y.`;
  if (edited && document.default_spawn_points?.length === 2) {
    note += ` Original defaults saved with this variant (not displayed): ${coordinates(document.default_spawn_points)}.`;
  }
  return { spawns, note };
}
