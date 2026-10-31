import recordings from 'virtual:replays';

const cache = new Map();
export const densityDefaults = () => ({ movement: false, deaths: false, olderVersions: false, movementOpacity: .7, deathOpacity: .8, smoothing: 10, contrast: .7 });
export function setupDensityControls(container, viewer, data, settings, mapEntry) {
  const root = document.createElement('fieldset'); root.className = 'terrain-density';
  root.innerHTML = `<legend>Replay density</legend>
    <label><span>Player time spent</span><input type="checkbox" data-density="movement"></label>
    <label><span>Bot deaths</span><input type="checkbox" data-density="deaths"></label>
    <label><span>Include unverified terrain matches</span><input type="checkbox" data-density="olderVersions"></label>
    <div class="density-sliders">
      <label>Player opacity <output data-value="movementOpacity"></output><input aria-label="Player density opacity" type="range" min="0" max="1" step=".05" data-density="movementOpacity"></label>
      <label>Death opacity <output data-value="deathOpacity"></output><input aria-label="Bot death density opacity" type="range" min="0" max="1" step=".05" data-density="deathOpacity"></label>
      <label>Smoothing <output data-value="smoothing"></output><input aria-label="Density smoothing in metres" type="range" min="0" max="30" step="1" data-density="smoothing"></label>
      <label>Contrast <output data-value="contrast"></output><input aria-label="Density contrast" type="range" min=".3" max="2" step=".1" data-density="contrast"></label>
    </div>
    <p class="density-status" role="status"></p>
    <div class="density-key"><span>Player time · low → high</span><i class="density-movement-ramp"></i><span>Bot deaths · low → high</span><i class="density-death-ramp"></i></div>
    <p>Relative to this map’s recordings. Each layer uses its own 95th percentile; hotspots saturate. Unvisited areas stay clear. Lower contrast reveals quieter areas.</p>
    <p>Time between snapshots is estimated; missing intervals are excluded. Bot deaths use the last recorded position and may be approximate.</p>`;
  const graphics = container.querySelector('.terrain-graphics');
  graphics.querySelector('summary').textContent = 'Map settings';
  graphics.querySelector('summary').after(root);
  const status = root.querySelector('.density-status');
  const candidates = recordings.filter(row => !row.synthetic && ((mapEntry.map_id && row.map_id === mapEntry.map_id) || row.map === data.id));
  const cacheKey = () => JSON.stringify([data.source, mapEntry.map_id, mapEntry.variant_id, mapEntry.variant_revision, settings.olderVersions]);
  let key = cacheKey();
  let worker, disposed = false, loaded = cache.get(key), loading = false;
  function update() {
    if (!settings.movement && !settings.deaths && loading) { worker?.terminate(); worker = null; loading = false; }
    for (const [name, value] of Object.entries(settings)) {
      const input = root.querySelector(`[data-density="${name}"]`);
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
      const output = root.querySelector(`[data-value="${name}"]`);
      if (output) output.textContent = name.includes('Opacity') ? `${Math.round(value * 100)}%` : name === 'smoothing' ? `${value} m` : `${value.toFixed(1)}×`;
    }
    root.querySelector('.density-sliders').hidden = root.querySelector('.density-key').hidden = !settings.movement && !settings.deaths;
    viewer.density(loaded?.result, settings);
    if (loaded) {
      const { result, skipped, failed } = loaded;
      status.textContent = `${result.rounds} recordings${result.approximateRounds ? ` (${result.approximateRounds} approximate: source differs; alignment unverified)` : ''} · ${(result.seconds / 60).toFixed(1)} player-minutes · ${result.deathCount} bot deaths${skipped ? ` · ${skipped} terrain versions excluded` : ''}${failed ? ` · ${failed} could not load` : ''}.${!result.rounds ? ' No exact replay data. Try Include unverified terrain matches for an approximate overlay.' : ''}`;
      if (failed) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry failed recordings';
        retry.addEventListener('click', () => { cache.delete(key); loaded = null; start(); }); status.append(' ', retry);
      }
    } else if (!candidates.length) status.textContent = 'No published replays for this map.';
    else if (!loading) status.textContent = `${candidates.length} available recordings. Enable a layer to load density.`;
  }
  function start() {
    if (disposed || loaded || loading || !candidates.length || (!settings.movement && !settings.deaths)) return;
    loading = true;
    status.textContent = 'Loading replay density…';
    worker = new Worker(new URL('./rotation-density-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: message }) => {
      if (disposed) return;
      if ('progress' in message) { status.textContent = `Loading replay density… ${message.progress} / ${message.total}`; return; }
      loaded = message; loading = false; worker.terminate(); worker = null;
      cache.set(key, loaded);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
      update();
    };
    worker.onerror = () => {
      worker.terminate(); worker = null; loading = false;
      status.textContent = 'Replay density could not load. Toggle a layer to retry.';
    };
    worker.postMessage({ olderVersions: settings.olderVersions, terrain: { source: data.source, bounds: data.bounds, map_id: mapEntry.map_id, variant_id: mapEntry.variant_id, variant_revision: mapEntry.variant_revision }, recordings: candidates.map(row => ({ ...row, url: new URL(import.meta.env.BASE_URL + row.url, location.href).href })) });
  }
  root.addEventListener('input', event => {
    const input = event.target, name = input.dataset.density;
    if (!name) return;
    if (name === 'olderVersions') { worker?.terminate(); worker = null; loading = false; }
    settings[name] = input.type === 'checkbox' ? input.checked : Number(input.value);
    if (name === 'olderVersions') { key = cacheKey(); loaded = cache.get(key); }
    update(); start();
  });
  if (!candidates.length) root.querySelectorAll('input').forEach(input => { input.disabled = true; });
  update(); start();
  return { dispose() { disposed = true; worker?.terminate(); root.remove(); } };
}
