import './style.css';
import maps from '../lib/maps.json';
import roundStatsCsv from '../map_round_stats.csv?raw';
import { setupServerStats } from './server-stats.js';
import { setupEditor } from './editor.js';
const $ = id => document.getElementById(id);
const imageEntries = images => Object.entries(images)
  .map(([path, image]) => ({ filename: path.split('/').pop(), image }))
  .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
const collections = {
  rotation: { images: imageEntries(import.meta.glob('../current_rotation/*.[pP][nN][gG]', { eager: true, query: '?url', import: 'default' })), index: 0 },
  good: { images: imageEntries(import.meta.glob('../goodmaps/*.[pP][nN][gG]', { eager: true, query: '?url', import: 'default' })), index: 0 },
  bad: { images: imageEntries(import.meta.glob('../badmaps/*.[pP][nN][gG]', { eager: true, query: '?url', import: 'default' })), index: 0 },
};
const [roundStatsHeaders, ...roundStatsRows] = roundStatsCsv.trim().split(/\r?\n/).map(line => line.split(','));
const roundStatsColumns = roundStatsHeaders.map((header, index) => ({ header, index })).filter(column => column.header !== 'timestamp_utc');
const roundResultIndex = roundStatsHeaders.indexOf('result');
const roundDurationIndex = roundStatsHeaders.indexOf('duration_seconds');
const roundStatsByMap = new Map();
for (const row of roundStatsRows) {
  if (!row[0]) continue;
  if (!roundStatsByMap.has(row[0])) roundStatsByMap.set(row[0], []);
  roundStatsByMap.get(row[0]).push(row);
}
function renderRoundStats(filename) {
  $('rotation-round-stats').hidden = !filename;
  const mapName = filename?.replace(/^scn_/, '').replace(/\.png$/i, '');
  const rows = roundStatsByMap.get(mapName) || [];
  const team1Wins = rows.filter(row => row[roundResultIndex] === 'team1').length;
  const durations = rows.map(row => row[roundDurationIndex]?.trim()).filter(value => value !== undefined && value !== '').map(Number).filter(value => Number.isFinite(value) && value >= 0);
  $('rotation-team1-average').textContent = rows.length ? `${(team1Wins / rows.length * 100).toFixed(1)}%` : '—';
  const averageSeconds = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
  $('rotation-duration-average').textContent = averageSeconds === null ? '—' : `${Math.floor(averageSeconds / 60)}m ${averageSeconds % 60}s`;
  $('rotation-round-caption').textContent = `Round stats · ${mapName || ''}`;
  $('rotation-round-rows').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const { index } of roundStatsColumns) {
      const td = document.createElement('td');
      td.textContent = row[index] || '—';
      tr.append(td);
    }
    return tr;
  }));
  $('rotation-round-table').hidden = !rows.length;
  $('rotation-round-empty').hidden = rows.length > 0;
}
const serverStats = setupServerStats(roundStatsHeaders, roundStatsRows);
const tabs = ['rotation', 'review', 'good', 'bad', 'server', 'editor'];
const editor = setupEditor(selectTab);
$('good-edit').addEventListener('click', () => editor.edit(collections.good.images[collections.good.index]?.filename));
let activeTab = 'rotation';
function renderCollection(name) {
  const { images, index } = collections[name];
  const entry = images[index];
  if (name === 'rotation') renderRoundStats(entry?.filename);
  if (name === 'good') {
    const available = editor.canEdit(entry?.filename);
    $('good-edit').disabled = !available;
    $('good-edit').textContent = available ? 'Edit this map' : 'Editor unavailable';
  }
  const el = suffix => $(name + '-' + suffix);
  el('previous').disabled = el('next').disabled = images.length < 2;
  el('count').textContent = `${entry ? index + 1 : 0} / ${images.length}`;
  el('full-image').hidden = el('image').hidden = !entry;
  el('state').hidden = false;
  if (!entry) {
    el('filename').textContent = 'No map images';
    el('state').textContent = 'No PNG images are available in this collection.';
    return;
  }
  el('filename').textContent = entry.filename;
  el('full-image').href = entry.image;
  el('state').textContent = 'Loading map…';
  el('image').style.opacity = '0';
  el('image').alt = entry.filename;
  el('image').src = entry.image;
}
function moveCollection(name, delta) {
  const collection = collections[name];
  if (!collection.images.length) return;
  collection.index = (collection.index + delta + collection.images.length) % collection.images.length;
  renderCollection(name);
}
function selectTab(name) {
  activeTab = name;
  for (const tab of tabs) {
    $(tab + '-tab').setAttribute('aria-selected', String(tab === name));
    $(tab + '-tab').tabIndex = tab === name ? 0 : -1;
    $(tab + '-panel').hidden = tab !== name;
  }
  if (name === 'editor') editor.show();
  $('collection-summary').textContent = name === 'server' ? `${serverStats.count} population samples` : name === 'editor' ? `${editor.count} maps to edit` : name === 'review' ? `${maps.length} maps to review` : `${collections[name].images.length} ${name === 'rotation' ? 'rotation images' : name + ' maps'}`;
}
for (const name of tabs) {
  $(name + '-tab').addEventListener('click', () => selectTab(name));
  $(name + '-tab').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(name) + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
    selectTab(next);
    $(next + '-tab').focus();
  });
}
$('view-keep-list').addEventListener('click', () => selectTab('review'));
for (const name of Object.keys(collections)) {
  $(name + '-previous').addEventListener('click', () => moveCollection(name, -1));
  $(name + '-next').addEventListener('click', () => moveCollection(name, 1));
  $(name + '-image').addEventListener('load', () => {
    $(name + '-state').hidden = true;
    $(name + '-image').style.opacity = '1';
  });
  $(name + '-image').addEventListener('error', () => {
    $(name + '-state').hidden = false;
    $(name + '-state').textContent = 'Map image could not load. Try refreshing the page.';
  });
}
const storageKey = 'maproom.keep-list.v1';
const pairKey = (map, spawn) => `${map}/${spawn}`;
let mapIndex = 0, spawnIndex = 0, kept = new Set(), storageProblem = '';
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('Invalid saved list');
  const valid = new Set(maps.flatMap(m => m.spawns.map(s => pairKey(m.id, s.id))));
  kept = new Set(saved.filter(key => valid.has(key)));
} catch {
  storageProblem = 'Browser storage could not be read. Copy your list before leaving this page.';
}
const currentMap = () => maps[mapIndex];
const currentSpawn = () => currentMap().spawns[spawnIndex];
function message(text) {
  $('status').textContent = storageProblem || text;
  $('status').classList.toggle('error', !!storageProblem);
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...kept]));
    storageProblem = '';
  } catch {
    storageProblem = 'Browser storage is unavailable. Your list is only kept for this visit—copy it before leaving.';
  }
}
function entries() {
  return maps.flatMap((map, mi) => map.spawns.flatMap((spawn, si) => kept.has(pairKey(map.id, spawn.id)) ? [{ map, spawn, mi, si }] : []));
}
function updateList() {
  const rows = entries();
  $('keep-count').textContent = `${rows.length} kept`;
  $('empty-list').hidden = rows.length > 0;
  $('copy').disabled = rows.length === 0;
  $('share-text').value = rows.length ? `Keep list\n${rows.map(({ map, spawn }) => `${map.id} | ${spawn.id}`).join('\n')}` : '';
  $('copy-status').textContent = '';
  $('selections').replaceChildren(...rows.map(({ map, spawn, mi, si }) => {
    const li = document.createElement('li'); li.className = 'selection';
    const link = document.createElement('button'); link.className = 'selection-link'; link.textContent = `${map.name} · ${spawn.label}`;
    link.addEventListener('click', () => { mapIndex = mi; spawnIndex = si; render(); $('map-title').scrollIntoView({ behavior: 'instant', block: 'start' }); });
    const remove = document.createElement('button'); remove.className = 'remove-selection'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${map.name}, ${spawn.label}`);
    remove.addEventListener('click', () => { kept.delete(pairKey(map.id, spawn.id)); persist(); render(); message(`Removed ${map.name} · ${spawn.label}.`); });
    li.append(link, remove); return li;
  }));
}
function render() {
  const map = currentMap(), spawn = currentSpawn();
  $('map-title').textContent = map.name;
  $('map-count').textContent = `${String(mapIndex + 1).padStart(3, '0')} / ${maps.length}`;
  $('image-label').textContent = `${map.name} / ${spawn.label}`;
  $('full-image').href = spawn.image;
  const img = $('map-image');
  if (img.getAttribute('src') !== spawn.image) {
    $('image-state').hidden = false; $('image-state').textContent = 'Loading map…'; img.style.opacity = '0'; img.src = spawn.image;
  }
  img.alt = `${map.name}, ${spawn.label} spawn setup`;
  $('spawns').replaceChildren(...map.spawns.map((s, index) => {
    const button = document.createElement('button'); button.className = `spawn${index === spawnIndex ? ' active' : ''}`; button.setAttribute('aria-pressed', String(index === spawnIndex));
    const number = document.createElement('span'); number.className = 'spawn-number'; number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span'); label.textContent = s.label; button.append(number, label);
    if (kept.has(pairKey(map.id, s.id))) { const badge = document.createElement('span'); badge.className = 'spawn-badge'; badge.textContent = '✓ Kept'; button.append(badge); }
    button.addEventListener('click', () => { spawnIndex = index; render(); }); return button;
  }));
  const selected = kept.has(pairKey(map.id, spawn.id));
  $('keep').textContent = selected ? '✓ Kept · Remove' : '+ Keep this setup';
  $('keep').classList.toggle('is-kept', selected);
  $('keep').setAttribute('aria-pressed', String(selected));
  $('keep-context').textContent = `${map.name} · ${spawn.label}`;
  updateList();
}
$('keep').addEventListener('click', () => {
  const map = currentMap(), spawn = currentSpawn(), key = pairKey(map.id, spawn.id);
  const removing = kept.has(key);
  if (removing) kept.delete(key); else kept.add(key);
  persist(); render(); message(`${removing ? 'Removed' : 'Kept'} ${map.name} · ${spawn.label}${removing ? '.' : ' · saved in this browser.'}`);
});
$('copy').addEventListener('click', async () => {
  if (!kept.size) return;
  const text = $('share-text').value;
  try {
    await navigator.clipboard.writeText(text);
    $('copy-status').textContent = 'Copied! Paste it into a message and send it.';
    $('copy-status').classList.remove('error');
  } catch {
    $('share-text').focus(); $('share-text').select(); $('share-text').setSelectionRange(0, text.length);
    $('copy-status').textContent = 'Select the text above and copy it with Ctrl+C, ⌘C, or your device’s Copy option.';
    $('copy-status').classList.add('error');
  }
});
$('map-image').addEventListener('load', () => { $('image-state').hidden = true; $('map-image').style.opacity = '1'; });
$('map-image').addEventListener('error', () => { $('image-state').hidden = false; $('image-state').textContent = 'Map image could not load. Try refreshing the page.'; });
function moveMap(delta) { mapIndex = (mapIndex + delta + maps.length) % maps.length; spawnIndex %= currentMap().spawns.length; render(); }
$('previous').addEventListener('click', () => moveMap(-1));
$('next').addEventListener('click', () => moveMap(1));
document.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
  if (collections[activeTab]) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveCollection(activeTab, event.key === 'ArrowLeft' ? -1 : 1);
    }
    return;
  }
  if (activeTab !== 'review') return;
  event.preventDefault();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') moveMap(event.key === 'ArrowLeft' ? -1 : 1);
  else { spawnIndex = (spawnIndex + (event.key === 'ArrowUp' ? -1 : 1) + currentMap().spawns.length) % currentMap().spawns.length; render(); }
});
render(); message('Keep the setups you like, then copy your list to share.');

Object.keys(collections).forEach(renderCollection);
selectTab('rotation');
