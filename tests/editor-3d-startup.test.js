import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Exercise the real attachment code across DOM realms without a WebGL context.
// These dependencies are only needed when the user switches from 2D to 3D.
const bundled = await build({
  entryPoints: [new URL('../src/editor-3d.js', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'startup-fixtures', setup(builder) {
    builder.onResolve({ filter: /topology-viewer\.js$|rotation-density-controls\.js$|\.css\?inline$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.includes('topology-viewer') ? 'export function createTopologyViewer() { throw new Error("Unexpected WebGL startup"); }'
        : args.path.includes('rotation-density-controls') ? 'export const densityDefaults = () => ({}); export function setupDensityControls() {}'
          : 'export default "";',
    }));
  } }],
});
const { attachEditor3D } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [template, coordinates, app, maps] = await Promise.all([
  'map_editor/web/index.html', 'map_editor/web/coordinates.js', 'map_editor/web/app.js', 'lib/editor-maps.json',
].map(read));
const project = JSON.parse(await read('public/' + JSON.parse(maps)[0].project));

test('3D bridge attaches in the editor realm and can reopen without losing placements', () => {
  const dom = new JSDOM(template.replace('__EDITOR_DATA__', JSON.stringify(project)), {
    runScripts: 'outside-only', url: 'https://editor.test/', pretendToBeVisual: true,
  });
  const win = dom.window, doc = win.document;
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.eval(coordinates); win.eval(app);
  const frame = { contentWindow: win, contentDocument: doc, dataset: { editorView: '2d' } };
  const signals = [];
  const Controller = win.AbortController;
  win.AbortController = class extends Controller {
    constructor() { super(); signals.push(this.signal); }
  };
  let bridge;
  try {
    win.MapEditor.placeAt(200, 300);
    const saved = JSON.stringify(win.MapEditor.getState().document);
    for (let visit = 0; visit < 2; visit++) {
      bridge = attachEditor3D(frame, project, {}, {}, path => path);
      assert.equal(doc.querySelectorAll('#editor-view-3d').length, 1);
      const align = doc.getElementById('line-align-path');
      const randomYaw = doc.getElementById('line-random-yaw');
      assert.equal(align.checked, true);
      assert.equal(randomYaw.checked, false);
      assert.equal(doc.getElementById('line-angle-offset').value, '0');
      randomYaw.click();
      assert.equal(align.checked, false);
      align.click();
      assert.equal(randomYaw.checked, false);
      doc.getElementById('line-reroll-yaw').click();
      assert.equal(align.checked, false);
      assert.equal(randomYaw.checked, true);
      assert.equal(signals.length, visit + 1);
      assert.equal(signals[visit].aborted, false);
      assert.equal(doc.getElementById('viewport').hidden, false);
      assert.equal(JSON.stringify(win.MapEditor.getState().document), saved);
      bridge.dispose();
      assert.equal(signals[visit].aborted, true);
      assert.equal(doc.querySelectorAll('#editor-view-3d, #editor-three, .editor-line-panel').length, 0);
      assert.equal(JSON.stringify(win.MapEditor.getState().document), saved);
    }
  } finally {
    bridge?.dispose(); dom.window.close();
  }
});
