// Match identities across recorded map names and exported placement filenames.
export function variantId(value, mapId) {
  const name = String(value || '').trim().split(/[\\/]/).pop().replace(/\.(?:placements(?:\.json)?|json)$/i, '');
  if (!name || /^(source|raw)$/i.test(name) || name.toLowerCase() === `${mapId}_RAW`.toLowerCase() || name === mapId) return 'source';
  const prefix = `${mapId}_`;
  return (name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name).toLowerCase();
}

export function recordedVariantId(map, mapId = map.map_id) {
  const explicit = map.variant_id || map.variant_filename;
  if (explicit) return variantId(explicit, mapId);
  const name = map.map_name || '';
  return mapId && name.toLowerCase().startsWith(`${mapId}_`.toLowerCase()) ? variantId(name, mapId) : 'source';
}

export function roundVariant(headers, row, mapId) {
  const recorded = row[headers.indexOf('variant_id')];
  if (recorded?.trim()) return variantId(recorded, mapId);
  const name = row[headers.indexOf('map_name')]?.replace(/^scn_/, '');
  return name?.toLowerCase().startsWith(`${mapId}_`.toLowerCase()) ? variantId(name, mapId) : 'source';
}

export function includedVariants(files, mapId) {
  const variants = Object.entries(files).filter(([path]) => path.includes(`/${mapId}/variants/`)).map(([path, value]) => {
    const filename = path.split('/').pop();
    const raw = typeof value === 'string' ? value : null;
    return { path, filename, map_id: mapId, id: variantId(filename, mapId), label: filename.replace(/\.(?:placements(?:\.json)?|json)$/i, '').replace(`${mapId}_`, ''), document: raw === null ? value : JSON.parse(raw), raw };
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  // Windows exports can have either extension. Identical copies of one named
  // loadout need only one option; distinct archived revisions remain available.
  return variants.filter((variant, index) => !variants.slice(0, index).some(previous =>
    previous.id === variant.id && (previous.raw !== null && variant.raw !== null
      ? previous.raw === variant.raw : JSON.stringify(previous.document) === JSON.stringify(variant.document))));
}

export function assertVariantSource(document, terrain) {
  for (const key of ['sco_sha256', 'recipe_sha256', 'terrain_code']) {
    if (!document.source?.[key] || document.source[key] !== terrain.source[key]) throw new Error('Variant belongs to a different terrain revision.');
  }
}
