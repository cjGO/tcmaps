// Asset discovery stays independent of the map brush and the line's chosen mix.
export function createLineAssetPicker(host, assets, { selection, onAdd }) {
  const doc = host.ownerDocument;
  host.innerHTML = `<h4>Find assets</h4>
    <label>Search assets<input id="line-asset-search" type="search" placeholder="Try pine, rock, fence…" autocomplete="off"></label>
    <label>Category<select id="line-asset-category"><option value="">All categories</option></select></label>
    <div class="asset-views" role="group" aria-label="Line asset collection"><button type="button" id="line-browse-all" aria-pressed="true">All assets</button><button type="button" id="line-browse-favorites" aria-pressed="false">★ Favorites</button></div>
    <figure class="line-picker-preview"><div id="line-picker-image"></div><figcaption id="line-picker-caption">Hover or focus an asset to preview it.</figcaption></figure>
    <p class="hint">Hover to preview · Click Add to mix · Keep browsing</p>
    <p id="line-picker-count" role="status"></p>
    <div id="line-picker-list" tabindex="0" role="region" aria-label="Available line assets"></div>
    <p id="line-picker-status" class="hint" role="status"></p>`;
  const $ = id => host.querySelector(`#${id}`);
  const byName = new Map(assets.map(a => [a.name, a]));
  let favorites = new Set(), favoritesOnly = false, signature = '', selectionSignature = '', previewName = '';
  for (const group of new Set(assets.map(a => a.group))) {
    const option = doc.createElement('option'); option.value = group; option.textContent = group;
    $('line-asset-category').append(option);
  }
  function image(asset, large = false) {
    const box = doc.createElement('span'); box.className = 'line-picker-thumb';
    box.textContent = 'No preview';
    if (asset.preview) {
      const img = doc.createElement('img'); img.alt = large ? `${asset.label} model preview` : '';
      img.loading = large ? 'eager' : 'lazy'; img.src = asset.preview;
      img.addEventListener('error', () => { box.textContent = 'Preview unavailable'; });
      box.replaceChildren(img);
    }
    return box;
  }
  function preview(asset) {
    if (previewName === asset.name) return;
    previewName = asset.name;
    $('line-picker-image').replaceChildren(image(asset, true));
    $('line-picker-caption').textContent = `${asset.label} · ${asset.group}`;
  }
  function render() {
    const query = $('line-asset-search').value.trim().toLowerCase(), group = $('line-asset-category').value;
    const matches = assets.filter(a => (!favoritesOnly || favorites.has(a.name)) && (!group || a.group === group)
      && `${a.label} ${a.name} ${a.mesh ?? ''}`.toLowerCase().includes(query));
    $('line-browse-all').setAttribute('aria-pressed', String(!favoritesOnly));
    $('line-browse-favorites').setAttribute('aria-pressed', String(favoritesOnly));
    $('line-picker-count').textContent = `${matches.length} assets · ${selection.size} in mix`;
    const list = $('line-picker-list'); list.replaceChildren();
    if (!matches.length) list.textContent = favoritesOnly ? 'No favorites match. Try All assets or clear your filters.' : 'No assets match. Try another search or category.';
    for (const asset of matches) {
      const row = doc.createElement('div'); row.className = 'line-picker-row'; row.dataset.asset = asset.name;
      const inspect = doc.createElement('button'); inspect.type = 'button'; inspect.className = 'line-picker-inspect';
      inspect.setAttribute('aria-label', `Preview ${asset.label}`);
      const title = doc.createElement('span'); title.textContent = asset.label;
      inspect.append(image(asset), title);
      const add = doc.createElement('button'); add.type = 'button'; add.className = 'line-picker-add';
      function sync() {
        const added = selection.has(asset.name); add.textContent = added ? '✓ Added' : '+ Add';
        add.setAttribute('aria-label', `${added ? 'Added' : 'Add'} ${asset.label}${added ? '' : ' to mix'}`);
        add.setAttribute('aria-disabled', String(added)); row.classList.toggle('in-mix', added);
      }
      sync();
      row.addEventListener('pointerenter', () => preview(asset));
      row.addEventListener('focusin', () => preview(asset));
      inspect.addEventListener('click', () => preview(asset));
      add.addEventListener('click', () => {
        if (selection.has(asset.name)) return;
        onAdd(asset); sync();
        $('line-picker-count').textContent = `${matches.length} assets · ${selection.size} in mix`;
        $('line-picker-status').textContent = `${asset.label} added to mix.`;
      });
      row.append(inspect, add); list.append(row);
    }
  }
  $('line-asset-search').addEventListener('input', render);
  $('line-asset-category').addEventListener('change', render);
  $('line-browse-all').addEventListener('click', () => { favoritesOnly = false; render(); });
  $('line-browse-favorites').addEventListener('click', () => { favoritesOnly = true; render(); });
  return {
    update(names = []) {
      const next = JSON.stringify(names), chosen = JSON.stringify([...selection.keys()]);
      if (signature === next && selectionSignature === chosen) return;
      selectionSignature = chosen;
      if (signature !== next) {
        signature = next; favorites = new Set(names); render();
      } else {
        for (const row of $('line-picker-list').querySelectorAll('.line-picker-row')) {
          const asset = byName.get(row.dataset.asset), added = selection.has(asset.name);
          const add = row.querySelector('.line-picker-add');
          add.textContent = added ? '✓ Added' : '+ Add';
          add.setAttribute('aria-label', `${added ? 'Added' : 'Add'} ${asset.label}${added ? '' : ' to mix'}`);
          add.setAttribute('aria-disabled', String(added)); row.classList.toggle('in-mix', added);
        }
        const count = $('line-picker-list').querySelectorAll('.line-picker-row').length;
        $('line-picker-count').textContent = `${count} assets · ${selection.size} in mix`;
      }
    },
  };
}
