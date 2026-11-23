import { DENSITY_UNITS, selectDensity } from './rotation-density.js';
import { densityFromPreparedHeat, preparedHeatLoader } from './prepared-heatmaps.js';
export const densityDefaults = () => ({ units: DENSITY_UNITS.map(([id]) => id), deathKind: 'player', movement: false, deaths: false, comparison: false, compareVariant: '', compareMetric: 'deaths', compareScale: 'per-recording', compareOpacity: .8, movementOpacity: .7, deathOpacity: .8, smoothing: 10, contrast: .7 });
const variantLabel = id => /^var[a-z]$/i.test(id) ? `Var${id.slice(3).toUpperCase()}` : id;

export function setupDensityControls(container, viewer, data, settings, mapEntry,
  loadHeat = preparedHeatLoader(mapEntry.map_id, data.bounds)) {
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
  graphics.querySelector('summary').textContent = 'Map settings & heatmaps';
  graphics.querySelector('summary').after(root);
  const status = root.querySelector('.density-status');
  root.querySelector('.density-comparison').hidden = true;
  const variant = mapEntry.selectedVariant || 'all';
  const variantNote = variant === 'all' ? 'All variants combined.' : `${variant === 'source' ? 'Source / RAW' : mapEntry.variantLabel || variant} recordings only.`;
  let archive, density, filtered, filterKey, filterSource;
  let disposed = false, loading = false, failed = false;
  const enabled = () => settings.comparison || settings.movement || settings.deaths;
  function setDensity() {
    if (archive) density = densityFromPreparedHeat(archive, variant, settings.comparison ? settings.compareVariant : undefined);
  }
  async function load() {
    if (disposed || loading || archive || !loadHeat) return;
    loading = true; failed = false;
    update();
    try {
      const data = await loadHeat();
      if (disposed) return;
      archive = data;
      const variants = archive.groups.map(group => group.variant).filter(id => !['source', 'unidentified'].includes(id));
      const canCompare = variants.length > 0 && archive.groups.some(group => group.variant === 'source');
      root.querySelector('.density-comparison').hidden = !canCompare;
      if (!canCompare) settings.comparison = false;
      if (!variants.includes(settings.compareVariant)) settings.compareVariant = variants.includes(variant) ? variant : variants[0] || '';
      root.querySelector('[data-density=compareVariant]').replaceChildren(...variants.map(id => new document.defaultView.Option(variantLabel(id), id)));
      setDensity();
    } catch {
      archive = undefined;
      density = undefined;
      failed = true;
    } finally {
      loading = false;
      if (!disposed) update();
    }
  }
  const onSettingsToggle = () => { if (graphics.open) load(); };
  graphics.addEventListener('toggle', onSettingsToggle);
  if (!loadHeat) {
    root.querySelectorAll('input, select, button').forEach(input => { input.disabled = true; });
  }
  function update() {
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
    if (filterSource !== density || filterKey !== nextFilterKey) {
      filterSource = density; filterKey = nextFilterKey;
      filtered = selectDensity(filterSource, settings.units, settings.deathKind);
    }
    viewer.density(filtered, settings);
    if (!loadHeat) status.textContent = 'No prepared heatmap data for this map.';
    else if (loading) status.textContent = 'Loading prepared heatmap…';
    else if (failed) {
      status.textContent = 'The prepared heatmap could not load. ';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
      retry.addEventListener('click', load); status.append(retry);
    } else if (!filtered) status.textContent = 'Enable a layer to load the prepared heatmap.';
    else if (settings.comparison) {
      const { source, target } = filtered.comparison;
      const average = settings.compareScale !== 'totals';
      const metric = settings.compareMetric === 'movement' ? 'player-minutes' : 'deaths';
      const amount = group => ((metric === 'player-minutes' ? group.seconds / 60 : group.deathCount) / (average ? Math.max(group.rounds, 1) : 1)).toFixed(1);
      status.textContent = `RAW · ${source.rounds} recordings · ${amount(source)} ${metric}${average ? ' per recording' : ''}. ${variantLabel(settings.compareVariant)} · ${target.rounds} recordings · ${amount(target)} ${metric}${average ? ' per recording' : ''}.`;
    } else if (!filtered.rounds) status.textContent = `No recorded heatmap data for this selection. ${variantNote}`;
    else {
      status.textContent = `${filtered.rounds} recordings · ${(filtered.seconds / 60).toFixed(1)} player-minutes · ${filtered.deathCount} deaths. ${variantNote}`;
      status.append(` Deaths for ${settings.deathKind === 'all' ? 'players and bots' : settings.deathKind === 'player' ? 'players' : 'bots'}.`);
    }
    if (filtered && !settings.units.length) status.append(' No unit types selected.');
  }
  root.addEventListener('input', event => {
    const input = event.target, name = input.dataset.density;
    if (input.dataset.densityUnit) {
      settings.units = [...root.querySelectorAll('[data-density-unit]:checked')].map(el => el.dataset.densityUnit);
      update(); return;
    }
    if (!name) return;
    const reload = name === 'comparison' || name === 'compareVariant';
    settings[name] = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value);
    if (reload) setDensity();
    update();
    if (enabled() && !failed) load();
  });
  root.addEventListener('click', event => {
    const action = event.target.dataset.unitsAction;
    if (!action) return;
    settings.units = action === 'all' ? DENSITY_UNITS.map(([id]) => id) : [];
    update();
  });
  settings.units ??= DENSITY_UNITS.map(([id]) => id);
  settings.deathKind ??= 'player';
  update();
  if (enabled() || graphics.open) load();
  return { dispose() { disposed = true; graphics.removeEventListener('toggle', onSettingsToggle); root.remove(); } };
}
