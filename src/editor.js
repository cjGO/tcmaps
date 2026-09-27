import editorMaps from '../lib/editor-maps.json';
import template from '../map_editor/web/index.html?raw';
import styles from '../map_editor/web/style.css?raw';
import coordinates from '../map_editor/web/coordinates.js?raw';
import app from '../map_editor/web/app.js?raw';

export function setupEditor(selectTab) {
  const $ = id => document.getElementById(id);
  const frames = new Map();
  let current = '', request = 0;
  const url = path => new URL(import.meta.env.BASE_URL + path, location.href).href;
  $('editor-map').replaceChildren(...editorMaps.map(map => new Option(map.filename, map.id)));
  $('editor-map').disabled = !editorMaps.length;

  async function open(id = current || editorMaps[0]?.id) {
    const map = editorMaps.find(map => map.id === id);
    if (!map) { $('editor-state').textContent = 'No GOODMAPS are available to edit.'; return; }
    current = id;
    $('editor-map').value = id;
    const token = ++request;
    for (const [key, frame] of frames) frame.hidden = key !== id;
    $('editor-state').hidden = frames.has(id);
    $('editor-retry').hidden = true;
    if (frames.has(id)) {
      if (frames.get(id).dataset.imageFailed === 'true') {
        $('editor-state').textContent = 'The editor image could not load. Check your connection and retry.';
        $('editor-state').hidden = false;
        $('editor-retry').hidden = false;
      }
      return;
    }
    $('editor-state').textContent = 'Loading ' + map.filename + '…';
    try {
      const response = await fetch(url(map.project));
      if (!response.ok) throw new Error('Project could not load');
      const project = await response.json();
      if (token !== request) return;
      const frame = document.createElement('iframe');
      frame.className = 'map-editor-frame';
      frame.title = 'Map editor — ' + map.filename;
      // The existing editor runs intact in its own document, isolating its CSS,
      // IDs and keyboard shortcuts from the map browser. Keep visited frames alive.
      frame.srcdoc = template
        .replace('/* EDITOR_STYLE */', () => styles + '\n#viewport{height:min(70vw,800px)}@media(max-width:600px){#viewport{height:90vw;max-height:500px}}')
        .replace('/* EDITOR_CORE */', () => coordinates)
        .replace('/* EDITOR_APP */', () => app)
        .replace('__EDITOR_DATA__', () => JSON.stringify(project).replaceAll('<', '\\u003c'))
        .replace('data:image/png;base64,__HEATMAP__', () => url(map.heatmap))
        .replace('Save the JSON, then run the Python build command described in the README.', 'Click Save map loadout JSON, then send the downloaded file to the map organizer. You can reopen it with Open loadout to continue editing.');
      frame.addEventListener('load', () => {
        // Fit the whole sidebar into the page; only the zoomable map scrolls.
        const resize = () => {
          if (frame.offsetWidth) frame.style.height = Math.ceil(frame.contentDocument.body.getBoundingClientRect().height) + 2 + 'px';
        };
        new ResizeObserver(resize).observe(frame.contentDocument.body);
        resize();
        if (current === id) $('editor-state').hidden = true;
        const image = frame.contentDocument.getElementById('heatmap');
        image.addEventListener('load', () => { frame.dataset.imageFailed = 'false'; });
        const failed = () => {
          frame.dataset.imageFailed = 'true';
          if (current !== id) return;
          $('editor-state').textContent = 'The editor image could not load. Check your connection and retry.';
          $('editor-state').hidden = false;
          $('editor-retry').hidden = false;
        };
        image.addEventListener('error', failed);
        if (image.complete && !image.naturalWidth) failed();
      });
      frames.set(id, frame);
      $('editor-workspace').append(frame);
    } catch {
      if (token !== request) return;
      $('editor-state').textContent = 'The editor could not load. Check your connection and retry.';
      $('editor-retry').hidden = false;
    }
  }
  $('editor-map').addEventListener('change', () => open($('editor-map').value));
  $('editor-retry').addEventListener('click', () => {
    const frame = frames.get(current);
    if (frame) {
      // Retry only the failed image so existing edits remain intact.
      const image = frame.contentDocument.getElementById('heatmap');
      image.addEventListener('load', () => { $('editor-state').hidden = true; $('editor-retry').hidden = true; }, { once: true });
      image.src = url(editorMaps.find(map => map.id === current).heatmap);
    } else open();
  });
  return {
    count: editorMaps.length,
    canEdit: filename => editorMaps.some(map => map.filename === filename),
    show: () => { if (!current) open(); },
    edit: filename => {
      const map = editorMaps.find(map => map.filename === filename);
      if (!map) return;
      open(map.id);
      selectTab('editor');
    },
  };
}
