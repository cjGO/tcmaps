import { setupReplayV3 } from './replay-v3-controls.js';
import { renderReplayCatalog } from './replay-catalog.js';

export function v3Link(href, id, seconds) {
  const url = new URL(href);
  for (const key of ['replay', 't', 'end', 'follow']) url.searchParams.delete(key);
  url.searchParams.set('tab', 'replay3'); url.hash = '';
  if (id) url.searchParams.set('replay', id);
  if (Number.isFinite(seconds) && seconds >= 0) url.searchParams.set('t', String(Math.round(seconds * 1000) / 1000));
  return url.href;
}

export function setupReplayV3Tab(root, recordings) {
  // Keep the additional catalogue and controls out of the existing tabs' startup.
  let instance;
  const ready = () => instance ??= createReplayV3Tab(root, recordings);
  return {
    setVisible(value) { if (value) ready().setVisible(true); else instance?.setVisible(false); },
    openDefault() { return ready().openDefault(); },
    restoreLocation() { return ready().restoreLocation(); },
    diagnostics() { return instance?.diagnostics(); },
  };
}

function createReplayV3Tab(root, recordings) {
  const available = recordings.filter(row => row.version === 2);
  root.innerHTML = `<div class="intro"><div><p class="eyebrow">THE BATTLE, RECONSTRUCTED</p><h1>Replay v3.</h1><p class="subtitle">Follow recorded volleys, trace inferred musket hits, and revisit the decisive moments. Uses your existing recordings.</p></div></div>
    <details class="replay-browser" data-v3-tab="browser" open><summary>Browse v2 recordings <span data-v3-tab="count"></span></summary><div class="replay-browser-content">
      <div class="replay-player-filter"><label>Map<select data-v3-tab="map"><option value="">All maps</option></select></label>
      <label>Player names<input data-v3-tab="names" type="search" placeholder="One or more names, separated by commas"></label>
      <label>Minimum players<input data-v3-tab="players" type="number" min="0" max="250" value="0"></label></div>
      <div class="replay-catalog" data-v3-tab="catalog" role="region" aria-label="Recordings for Replay v3" tabindex="0"></div></div></details>
    <section id="replay3-viewer" aria-label="Replay v3 viewer"></section>`;
  const el = key => root.querySelector(`[data-v3-tab="${key}"]`);
  let selectedId, started = false, visible = false;
  const viewer = setupReplayV3(root.querySelector('#replay3-viewer'), { onLocal() { selectedId = null; started = true; history.replaceState(null, '', v3Link(location.href)); render(); } });
  el('map').append(...[...new Set(available.map(r => r.map_id).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(id => new Option(id, id)));
  function render() {
    const count = renderReplayCatalog(el('catalog'), available, recording => open(recording), {
      selectedId, minimumPlayers: Math.max(0, Number(el('players').value) || 0), playerNames: el('names').value, mapId: el('map').value });
    el('count').textContent = `${count} of ${available.length}`;
    // Keep the original catalogue helper untouched, including v1/v2 permalinks.
    for (const row of el('catalog').querySelectorAll('.replay-entry')) row.querySelector('a').href = v3Link(location.href, row.querySelector('button').dataset.id);
  }
  async function open(recording, { syncUrl = true, t } = {}) {
    started = true; el('browser').open = false;
    const result = await viewer.openReplay(recording, { t });
    if (result?.header.id !== recording.id) return;
    selectedId = recording.id; render();
    if (syncUrl && visible) history.pushState(null, '', v3Link(location.href, recording.id, t));
  }
  for (const key of ['map', 'names', 'players']) el(key).addEventListener(key === 'names' || key === 'players' ? 'input' : 'change', render);
  render();
  return { setVisible(value) { visible = value; viewer.setVisible(value); }, diagnostics: viewer.diagnostics,
    openDefault() { if (!started && available.length) return open(available.find(r => r.round_ended) || available[0]); },
    restoreLocation() {
      const params = new URL(location.href).searchParams, id = params.get('replay');
      const recording = available.find(r => r.id === id);
      if (recording) return open(recording, { syncUrl: false, t: params.has('t') ? Number(params.get('t')) : undefined });
      if (!id && !started && available.length) return open(available.find(r => r.round_ended) || available[0], { syncUrl: false });
      if (id) { el('browser').open = true; root.querySelector('[data-v3="status"]').textContent = 'This recording is not available. Choose another v2 recording or open a local JSONL file.'; }
    } };
}
