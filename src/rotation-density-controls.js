import recordings from 'virtual:replays';
import { densityRecordingMatches, DENSITY_UNITS, selectDensity } from './rotation-density.js';
import { recordedVariantId } from './map-variants.js';

const cache = new Map();
export const densityDefaults = () => ({ units: DENSITY_UNITS.map(([id]) => id), deathKind: 'player', movement: false, deaths: false, comparison: false, compareVariant: '', compareMetric: 'deaths', compareScale: 'per-recording', compareOpacity: .8, movementOpacity: .7, deathOpacity: .8, smoothing: 10, contrast: .7 });
const variantLabel = id => /^var[a-z]$/i.test(id) ? `Var${id.slice(3).toUpperCase()}` : id;

export function setupDensityControls(container, viewer, data, settings, mapEntry) {
  const document = container.ownerDocument;
  const root = document.createElement('fieldset'); root.className = 'terrain-density';
  root.innerHTML = `<legend>Movement & death heatmaps</legend>
    <label data-normal><span>Player movement</span><input type="checkbox" data-density="movement"></label>
    <label data-normal><span>Deaths</span><input type="checkbox" data-density="deaths"></label>
    <label class="density-death-kind">Deaths of<select data-density="deathKind" aria-label="Deaths of"><option value="player">Players</option><option value="bot">Bots</option><option value="all">Players and bots</option></select></label>
    <fieldset class="density-units"><legend>Unit types</legend>
      ${DENSITY_UNITS.map(([id, label]) => `<label><span>${label}</span><input type="checkbox" data-density-unit="${id}" checked></label>`).join('')}
      <button type="button" data-units-action="all">All</button><button type="button" data-units-action="none">None</button>
    </fieldset>
    <p>Inf includes line infantry, guards and specialists; Light and Rifles are separate. Dragoons means ranged cavalry; Cav includes heavy melee cavalry. Unknown covers missing or unrecognized classes.</p>
    <section class="density-comparison">
      <label><span>Compare RAW vs variant</span><input type="checkbox" data-density="comparison"></label>
      <div data-comparison-controls>
        <label>Compare RAW with<select data-density="compareVariant" aria-label="Comparison variant"></select></label>
        <label>Compare layer<select data-density="compareMetric" aria-label="Comparison layer"><option value="deaths">Deaths</option><option value="movement">Player movement</option></select></label>
        <label>Values<select data-density="compareScale" aria-label="Comparison values"><option value="per-recording">Average per recording</option><option value="totals">Recorded totals</option></select></label>
      </div>
    </section>
    <div class="density-sliders">
      <label data-normal>Player opacity <output data-value="movementOpacity"></output><input aria-label="Player density opacity" type="range" min="0" max="1" step=".05" data-density="movementOpacity"></label>
      <label data-normal>Death opacity <output data-value="deathOpacity"></output><input aria-label="Death heatmap opacity" type="range" min="0" max="1" step=".05" data-density="deathOpacity"></label>
      <label data-comparison-opacity>Comparison opacity <output data-value="compareOpacity"></output><input aria-label="Comparison opacity" type="range" min="0" max="1" step=".05" data-density="compareOpacity"></label>
      <label>Smoothing <output data-value="smoothing"></output><input aria-label="Density smoothing in metres" type="range" min="0" max="30" step="1" data-density="smoothing"></label>
      <label>Contrast <output data-value="contrast"></output><input aria-label="Density contrast" type="range" min=".3" max="2" step=".1" data-density="contrast"></label>
    </div>
    <p class="density-status" role="status"></p>
    <div class="density-key" data-normal-key><span>Player time · low → high</span><i class="density-movement-ramp"></i><span>Deaths · low → high</span><i class="density-death-ramp"></i></div>
    <div class="density-key" data-comparison-key><span data-difference-label></span><i class="density-difference-ramp"></i><span>Clear = no difference · Stronger color = larger difference</span></div>
    <p data-explanation></p>
    <p>Time between snapshots is estimated; missing intervals are excluded. Deaths use the last recorded position and may be approximate.</p>`;
  const graphics = container.querySelector('.terrain-graphics');
  graphics.querySelector('summary').textContent = 'Map settings';
  graphics.querySelector('summary').after(root);
  const status = root.querySelector('.density-status');
  const baseTerrain = { id: data.id, map_id: mapEntry.map_id, source: data.source, bounds: data.bounds };
  const mapRecordings = recordings.filter(row => densityRecordingMatches(row, baseTerrain));
  const variants = [...new Set(mapRecordings.map(row => recordedVariantId(row, baseTerrain.map_id)))].filter(id => id !== 'source').sort();
  const canCompare = variants.length > 0 && mapRecordings.some(row => recordedVariantId(row, baseTerrain.map_id) === 'source');
  root.querySelector('.density-comparison').hidden = !canCompare;
  if (!canCompare) settings.comparison = false;
  if (!variants.includes(settings.compareVariant)) settings.compareVariant = variants.includes(mapEntry.selectedVariant) ? mapEntry.selectedVariant : variants[0] || '';
  root.querySelector('[data-density=compareVariant]').replaceChildren(...variants.map(id => new document.defaultView.Option(variantLabel(id), id)));
  const variantNote = !mapEntry.selectedVariant || mapEntry.selectedVariant === 'all' ? 'All variants combined.' : `${mapEntry.selectedVariant === 'source' ? 'Source / RAW' : mapEntry.variantLabel || mapEntry.selectedVariant} recordings only.`;
  let filtered, filterKey, filterSource;
  let terrain, candidates, key, worker, disposed = false, loaded, loading = false, generation = 0;
  const enabled = () => settings.comparison || settings.movement || settings.deaths;
  function context() {
    terrain = { ...baseTerrain, selectedVariant: settings.comparison ? 'all' : mapEntry.selectedVariant || 'all', comparisonVariant: settings.comparison ? settings.compareVariant : undefined };
    candidates = mapRecordings.filter(row => densityRecordingMatches(row, terrain));
    key = JSON.stringify([terrain.map_id, terrain.id, terrain.selectedVariant, terrain.comparisonVariant, terrain.bounds, candidates.map(row => [row.id, row.url])]);
    loaded = cache.get(key);
  }
  function cancel() { generation++; worker?.terminate(); worker = null; loading = false; }
  function update() {
    if (!enabled() && loading) cancel();
    for (const [name, value] of Object.entries(settings)) {
      const input = root.querySelector(`[data-density="${name}"]`);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
      const output = root.querySelector(`[data-value="${name}"]`);
      if (output) output.textContent = name.includes('Opacity') ? `${Math.round(value * 100)}%` : name === 'smoothing' ? `${value} m` : `${value.toFixed(1)}×`;
    }
    root.querySelectorAll('[data-normal]').forEach(el => { el.hidden = settings.comparison; });
    root.querySelector('[data-comparison-controls]').hidden = !settings.comparison;
    root.querySelector('[data-comparison-opacity]').hidden = !settings.comparison;
    root.querySelector('.density-sliders').hidden = !enabled();
    root.querySelector('[data-normal-key]').hidden = settings.comparison || !enabled();
    root.querySelector('[data-comparison-key]').hidden = !settings.comparison;
    root.querySelector('[data-difference-label]').textContent = `← More on RAW · More on ${variantLabel(settings.compareVariant)} →`;
    root.querySelector('[data-explanation]').textContent = settings.comparison
      ? 'Averages adjust for recording count; capture length and player count can differ. Comparison uses RAW and the chosen variant, regardless of which map variant is shown.'
      : 'Relative to this map’s recordings. Each layer uses its own 95th percentile; hotspots saturate. Unvisited areas stay clear. Lower contrast reveals quieter areas.';
    root.querySelectorAll('[data-density-unit]').forEach(input => { input.checked = settings.units.includes(input.dataset.densityUnit); });
    const nextFilterKey = JSON.stringify([settings.units, settings.deathKind]);
    if (filterSource !== loaded?.result || filterKey !== nextFilterKey) {
      filterSource = loaded?.result; filterKey = nextFilterKey;
      filtered = selectDensity(filterSource, settings.units, settings.deathKind);
    }
    viewer.density(filtered, settings);
    if (loaded) {
      const { skipped, failed } = loaded;
      const result = filtered;
      if (settings.comparison) {
        const { source, target } = result.comparison;
        const average = settings.compareScale !== 'totals';
        const metric = settings.compareMetric === 'movement' ? 'player-minutes' : 'deaths';
        const amount = group => ((settings.compareMetric === 'movement' ? group.seconds / 60 : group.deathCount) / (average ? Math.max(1, group.rounds) : 1)).toFixed(1);
        status.textContent = source.rounds && target.rounds
          ? `RAW: ${source.rounds} recordings · ${amount(source)} ${metric}${average ? ' per recording' : ''}. ${variantLabel(settings.compareVariant)}: ${target.rounds} recordings · ${amount(target)} ${metric}${average ? ' per recording' : ''}.`
          : 'Comparison needs at least one loaded RAW recording and one variant recording.';
      } else status.textContent = `${result.rounds} of ${candidates.length} recordings · ${(result.seconds / 60).toFixed(1)} player-minutes · ${result.deathCount} deaths${skipped ? ` · ${skipped} recordings excluded` : ''}. ${variantNote}`;
      status.append(` Deaths: ${settings.deathKind === 'all' ? 'players and bots' : settings.deathKind === 'player' ? 'players' : 'bots'}.`);
      if (!settings.units.length) status.append(' No unit types selected.');
      if (failed) {
        status.append(` ${failed} recordings could not load. `);
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry failed recordings';
        retry.addEventListener('click', () => { cache.delete(key); loaded = null; start(); }); status.append(retry);
      }
    } else if (!candidates.length) status.textContent = `No published replays for this selection. ${variantNote}`;
    else if (!loading) status.textContent = `${candidates.length} available recordings. ${settings.comparison ? 'Enable comparison to compare both groups.' : variantNote + ' Enable a layer to load density.'}`;
  }
  function start() {
    if (disposed || loaded || loading || !candidates.length || !enabled()) return;
    loading = true;
    status.textContent = 'Loading replay density…';
    const token = generation;
    worker = new Worker(new URL('./rotation-density-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: message }) => {
      if (disposed || token !== generation) return;
      if ('progress' in message) { status.textContent = `Loading replay density… ${message.progress} / ${message.total}`; return; }
      loaded = message; loading = false; worker.terminate(); worker = null;
      cache.set(key, loaded);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      update();
    };
    worker.onerror = () => {
      if (disposed || token !== generation) return;
      cancel(); status.textContent = 'Replay density could not load. Toggle a layer or comparison to retry.';
    };
    worker.postMessage({ terrain, recordings: candidates.map(row => ({ ...row, url: new URL(import.meta.env.BASE_URL + row.url, location.href).href })) });
  }
  root.addEventListener('input', event => {
    const input = event.target, name = input.dataset.density;
    if (input.dataset.densityUnit) {
      settings.units = [...root.querySelectorAll('[data-density-unit]:checked')].map(el => el.dataset.densityUnit);
      update(); start(); return;
    }
    if (!name) return;
    const reload = name === 'comparison' || name === 'compareVariant';
    if (reload) cancel();
    settings[name] = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value);
    if (reload) context();
    update(); start();
  });
  root.addEventListener('click', event => {
    const action = event.target.dataset.unitsAction;
    if (!action) return;
    settings.units = action === 'all' ? DENSITY_UNITS.map(([id]) => id) : [];
    update(); start();
  });
  settings.units ??= DENSITY_UNITS.map(([id]) => id);
  settings.deathKind ??= 'player';
  if (!mapRecordings.length) root.querySelectorAll('input').forEach(input => { input.disabled = true; });
  context(); update(); start();
  return { dispose() { disposed = true; cancel(); root.remove(); } };
}
