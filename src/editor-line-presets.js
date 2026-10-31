const STORAGE_KEY = 'map-editor.line-presets.v1';

function cleanEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Add at least one asset to the mix first.');
  const seen = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry.asset !== 'string' || !entry.asset || seen.has(entry.asset)
      || !Number.isFinite(entry.ratio) || entry.ratio <= 0) throw new Error('Every asset needs a positive ratio.');
    seen.add(entry.asset);
    const scale = entry.scale ?? {enabled:false, low:.8, high:1.2};
    if (typeof scale.enabled !== 'boolean' || !Number.isFinite(scale.low) || !Number.isFinite(scale.high)
      || scale.low < .1 || scale.high > 10 || scale.high < scale.low) throw new Error('Scale ranges must run from 0.1 to 10, with low ≤ high.');
    return {asset:entry.asset, ratio:entry.ratio, scale:{enabled:scale.enabled, low:scale.low, high:scale.high}};
  });
}

export function createLinePresets(host, assets, { getMix, applyMix }) {
  const doc = host.ownerDocument, win = doc.defaultView, byName = new Map(assets.map(a => [a.name, a]));
  host.innerHTML = `<h4>Preset mixes</h4>
    <label>Saved mixes<select id="line-preset-select"><option value="">Choose a preset…</option></select></label>
    <p id="line-preset-preview" class="hint"></p>
    <div class="line-preset-actions"><button type="button" id="line-preset-load" disabled>Load mix</button><button type="button" id="line-preset-update" disabled>Update saved mix</button></div>
    <label>Preset name<input id="line-preset-name" type="text" placeholder="e.g. Pine forest edge" autocomplete="off"></label>
    <div class="line-preset-actions"><button type="button" id="line-preset-save">Save as new</button><button type="button" id="line-preset-rename" disabled>Rename</button><button type="button" id="line-preset-delete" disabled>Delete</button></div>
    <p class="hint">Save as many mixes as you like in this browser. Includes assets, ratios and asset scale settings. Loading replaces the current mix.</p>
    <p id="line-preset-status" role="status" class="hint"></p>`;
  const $ = id => host.querySelector(`#${id}`);
  let presets = [];
  function status(message) { $('line-preset-status').textContent = message; }
  function read() {
    try {
      const saved = JSON.parse(win.localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(saved)) throw new Error();
      const ids = new Set();
      presets = saved.map(p => {
        if (!p || typeof p.id !== 'string' || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim()) throw new Error();
        ids.add(p.id);
        return {id:p.id, name:p.name, entries:cleanEntries(p.entries)};
      });
    } catch { status('Saved mixes could not be read. New changes will be available for this session.'); }
  }
  function selected() { return presets.find(p => p.id === $('line-preset-select').value); }
  function describe() {
    const preset = selected();
    for (const action of ['load', 'update', 'rename', 'delete']) $('line-preset-' + action).disabled = !preset;
    $('line-preset-preview').textContent = preset ? preset.entries.map(e => `${byName.get(e.asset)?.label ?? e.asset} (${e.ratio})${byName.has(e.asset) ? '' : ' · unavailable'}`).join(' · ') : 'Choose a saved mix to see its assets and ratios.';
  }
  function render(id = $('line-preset-select').value) {
    const select = $('line-preset-select'); select.replaceChildren();
    const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a preset…'; select.append(placeholder);
    for (const preset of presets) {
      const option = doc.createElement('option'); option.value = preset.id; option.textContent = `${preset.name} · ${preset.entries.length} assets`; select.append(option);
    }
    select.value = presets.some(p => p.id === id) ? id : ''; describe();
  }
  function commit(next, id, message) {
    let persisted = true;
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { persisted = false; }
    presets = next; render(id);
    status(message + (persisted ? '' : ' Browser storage is unavailable or full; this change is available for this session only.'));
  }
  function name() {
    const value = $('line-preset-name').value.trim();
    if (!value) throw new Error('Enter a name for this preset.');
    return value;
  }
  function unique(value, except) {
    if (presets.some(p => p.id !== except && p.name.toLowerCase() === value.toLowerCase())) throw new Error('That name is already used. Choose a different name or use Update saved mix.');
  }
  function action(id, fn) {
    $(id).addEventListener('click', () => { try { fn(); } catch (error) { status(error.message); } });
  }
  $('line-preset-select').addEventListener('change', () => {
    $('line-preset-name').value = selected()?.name ?? ''; describe(); status('');
  });
  action('line-preset-save', () => {
    const value = name(); unique(value);
    const preset = {id:win.crypto.randomUUID(), name:value, entries:cleanEntries(getMix())};
    commit([...presets, preset], preset.id, `Saved “${value}”.`);
  });
  action('line-preset-update', () => {
    const preset = selected(); if (!preset) return;
    commit(presets.map(p => p.id === preset.id ? {...p, entries:cleanEntries(getMix())} : p), preset.id, `Updated “${preset.name}”.`);
  });
  action('line-preset-rename', () => {
    const preset = selected(); if (!preset) return;
    const value = name(); unique(value, preset.id);
    commit(presets.map(p => p.id === preset.id ? {...p, name:value} : p), preset.id, `Renamed to “${value}”.`);
  });
  action('line-preset-delete', () => {
    const preset = selected(); if (!preset) return;
    commit(presets.filter(p => p.id !== preset.id), '', `Deleted “${preset.name}”. The current mix is unchanged.`);
    $('line-preset-name').value = '';
  });
  action('line-preset-load', () => {
    const preset = selected(); if (!preset) return;
    const available = preset.entries.filter(e => byName.has(e.asset)), missing = preset.entries.length - available.length;
    if (!available.length) throw new Error('None of this preset’s assets are available on this map. The current mix is unchanged.');
    applyMix(cleanEntries(available));
    status(`Loaded “${preset.name}”.${missing ? ` Skipped ${missing} unavailable assets.` : ''}`);
  });
  function sync(event) {
    if (event.key === STORAGE_KEY || event.key === null) { read(); render(); }
  }
  read(); render(); win.addEventListener('storage', sync);
  return {dispose() { win.removeEventListener('storage', sync); }};
}
