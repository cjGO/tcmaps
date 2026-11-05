import { replayAssets } from './replay-variant-assets.js';
import { inferRecordingVariant, replayPlacementDocument, replayMapIdentity } from './replay-variants.js';

export function createReplayVariantControl(host) {
  const label = document.createElement('label'); label.textContent = 'Map variant ';
  const select = document.createElement('select'); select.dataset.replay = 'variant';
  const notice = document.createElement('p'); notice.setAttribute('role', 'status');
  label.append(select); host.append(label, notice); label.hidden = true;
  const choices = new Map();
  let generation = 0, layer, context, placementDocument = null;
  function clear() {
    generation++; layer?.dispose(); layer = null; placementDocument = null;
    if (context) context.viewer.updateSpawns(context.data.spawns);
  }
  async function render() {
    clear();
    const token = generation, { viewer, data, variants, inferred } = context;
    const manual = select.value !== 'auto';
    const variant = manual ? variants.find(v => v.revision === select.value) : inferred.variant;
    notice.textContent = manual ? 'Manual variant overlay · recording match unverified.' : inferred.reason;
    if (!variant) { if (select.value === 'none') notice.textContent = 'No variant placements shown.'; return; }
    try {
      const document = replayPlacementDocument(variant, data, manual);
      const { createVariantLayer } = await import('./rotation-variant-layer.js');
      if (token !== generation) return;
      layer = createVariantLayer(viewer, data, document);
      await layer.ready;
      if (token !== generation) return;
      placementDocument = document;
      notice.textContent += ` ${variant.label} · ${document.placements.length} placements.`;
    } catch (error) {
      if (token !== generation) return;
      layer?.dispose(); layer = null;
      notice.textContent = error.message;
    }
  }
  select.addEventListener('change', () => {
    if (!context) return;
    choices.set(context.key, select.value);
    void render();
  });
  return {
    get document() { return placementDocument; },
    detach() { clear(); context = null; label.hidden = true; notice.textContent = ''; },
    async attach(viewer, data, map, key, reference = false) {
      this.detach();
      if (reference) return;
      const token = generation;
      const assets = await replayAssets;
      if (token !== generation) return;
      map = replayMapIdentity(map, assets.manifest.maps);
      const variants = [...new Map(assets.variants.filter(v => v.map_id === map.map_id).map(v => [v.revision, v])).values()];
      const inferred = inferRecordingVariant(map, variants);
      context = { viewer, data, key, variants, inferred };
      select.replaceChildren(new Option('Automatic (from recording)', 'auto'), new Option('Source / RAW · no placements', 'none'),
        ...variants.map(v => new Option(`${v.label} · ${v.revision.slice(0, 8)}`, v.revision)));
      select.value = choices.get(key) || 'auto';
      if (!select.value) select.value = 'auto';
      label.hidden = !variants.length;
      await render();
    },
  };
}
