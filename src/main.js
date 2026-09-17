import './style.css';
import maps from '../lib/maps.json';
const $ = id => document.getElementById(id);
const rotationImages = Object.entries(import.meta.glob('../current_rotation/*.[pP][nN][gG]', {
  eager: true, query: '?url', import: 'default',
})).map(([path, image]) => ({ filename: path.split('/').pop(), image }))
  .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
let rotationIndex = 0, activeTab = 'rotation';
function renderRotation() {
  const entry = rotationImages[rotationIndex];
  $('rotation-previous').disabled = $('rotation-next').disabled = rotationImages.length < 2;
  $('rotation-count').textContent = `${entry ? rotationIndex + 1 : 0} / ${rotationImages.length}`;
  $('rotation-full-image').hidden = !entry;
  if (!entry) {
    $('rotation-filename').textContent = 'No rotation images';
    $('rotation-state').textContent = 'No PNG images are available in the current rotation.';
    return;
  }
  $('rotation-filename').textContent = entry.filename;
  $('rotation-full-image').href = entry.image;
  $('rotation-state').hidden = false;
  $('rotation-state').textContent = 'Loading map…';
  $('rotation-image').style.opacity = '0';
  $('rotation-image').alt = entry.filename;
  $('rotation-image').src = entry.image;
}
function moveRotation(delta) {
  if (!rotationImages.length) return;
  rotationIndex = (rotationIndex + delta + rotationImages.length) % rotationImages.length;
  renderRotation();
}
function selectTab(name) {
  activeTab = name;
  for (const tab of ['rotation', 'review']) {
    $(tab + '-tab').setAttribute('aria-selected', String(tab === name));
    $(tab + '-tab').tabIndex = tab === name ? 0 : -1;
    $(tab + '-panel').hidden = tab !== name;
  }
  $('collection-summary').textContent = name === 'rotation' ? `${rotationImages.length} rotation images` : `${maps.length} maps to review`;
}
for (const name of ['rotation', 'review']) {
  $(name + '-tab').addEventListener('click', () => selectTab(name));
  $(name + '-tab').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === 'Home' ? 'rotation' : event.key === 'End' ? 'review' : name === 'rotation' ? 'review' : 'rotation';
    selectTab(next);
    $(next + '-tab').focus();
  });
}
$('view-keep-list').addEventListener('click', () => selectTab('review'));
$('rotation-previous').addEventListener('click', () => moveRotation(-1));
$('rotation-next').addEventListener('click', () => moveRotation(1));
$('rotation-image').addEventListener('load', () => {
  $('rotation-state').hidden = true;
  $('rotation-image').style.opacity = '1';
});
$('rotation-image').addEventListener('error', () => {
  $('rotation-state').hidden = false;
  $('rotation-state').textContent = 'Map image could not load. Try refreshing the page.';
});
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
  if (activeTab === 'rotation') {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveRotation(event.key === 'ArrowLeft' ? -1 : 1);
    }
    return;
  }
  event.preventDefault();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') moveMap(event.key === 'ArrowLeft' ? -1 : 1);
  else { spawnIndex = (spawnIndex + (event.key === 'ArrowUp' ? -1 : 1) + currentMap().spawns.length) % currentMap().spawns.length; render(); }
});
render(); message('Keep the setups you like, then copy your list to share.');

renderRotation();
selectTab('rotation');
