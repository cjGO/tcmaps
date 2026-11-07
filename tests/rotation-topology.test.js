import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { includedVariants } from '../src/map-variants.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const json = async path => JSON.parse(await read(path));
// Keep real preview resolution and DOM wiring; replace WebGL and asset loading.
const viewerImports = [];
const bundled = await build({
  entryPoints: [new URL('../src/rotation-topology.js', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
  plugins: [{ name: 'viewer-fixtures', setup(builder) {
    builder.onResolve({ filter: /(?:topology-viewer|rotation-variant-layer|rotation-density-controls|replay-controls)\.js$/ }, args => {
      if (/(?:topology-viewer|rotation-variant-layer)\.js$/.test(args.path)) viewerImports.push(args.kind);
      return { path: args.path, namespace: 'fixture' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.endsWith('topology-viewer.js') ? `export function createTopologyViewer(root, data) {
        globalThis.rotationTestViews.push(data);
        return { exaggeration() {}, contours() {}, wireframe() {}, preset() {}, dispose() {} };
      }` : args.path.endsWith('rotation-variant-layer.js') ? `export function createVariantLayer(viewer, data, document, provenance, options) {
        if (options.updateSpawns !== false) throw new Error('Late spawn override must be disabled');
        return { ready: Promise.resolve(), dispose() {} };
      }` : args.path.endsWith('rotation-density-controls.js') ? 'export const densityDefaults = () => ({}); export function setupDensityControls() { return { dispose() {} }; }'
        : 'export function setupReplay() { throw new Error("Not a replay test"); }',
    }));
  } }],
});
const { setupTopology } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('rotation viewer code loads with the page without a late deployment-sensitive chunk request', () => {
  assert.deepEqual(viewerImports, ['import-statement', 'import-statement']);
});

test('rotation switches VarA → RAW → VarA with matching viewer spawns and explicit labels', async () => {
  const dom = new JSDOM('<section id="rotation-panel"><div class="image-stage"><img id="rotation-image"><a id="rotation-full-image"></a><span id="rotation-state"></span></div></section>');
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = dom.window.document;
  globalThis.rotationTestViews = [];
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    return { ok: true, json: () => json('public' + url) };
  };
  let topology;
  try {
    const installed = (await json('lib/rotation-topology.json')).maps.find(map => map.map_id === 'test_map_116');
    const rawTerrain = (await json('lib/replay-topology.json')).maps.find(map => map.map_id === installed.map_id && map.variant_id === 'source');
    const path = 'maps/small/test_map_116/variants/test_map_116_VarA.placements.json';
    const [variant] = includedVariants({ [path]: await read(path) }, installed.map_id);
    topology = setupTopology();
    const state = document.getElementById('rotation-state');
    for (const selected of ['vara', 'source', 'vara']) {
      topology.setMap({ filename: installed.id + '.png', variantId: selected, variants: [variant], variant: selected === 'vara' ? variant : undefined });
      for (let attempt = 0; !state.hidden && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(state.hidden, true, state.textContent);
      const data = globalThis.rotationTestViews.at(-1);
      const note = document.querySelector('.topology-spawns').textContent;
      if (selected === 'source') {
        assert.equal(urls.at(-1), rawTerrain.url);
        assert.equal(data.spawns[0].x_m.toFixed(3), '124.800');
        assert.equal(data.spawns[1].x_m.toFixed(3), '595.200');
        assert.match(note, /Source \/ RAW original spawns/);
        assert.match(document.querySelector('.topology-heading strong').textContent, /Source \/ RAW/);
      } else {
        assert.equal(urls.at(-1), installed.url);
        assert.equal(data.spawns[0].x_m, 252.352);
        assert.equal(data.spawns[1].x_m, 284.122);
        assert.match(note, /Variant spawns · VarA/);
        assert.match(note, /Original defaults saved with this variant/);
      }
    }
    assert.equal(globalThis.rotationTestViews.length, 3);
  } finally {
    topology?.setVisible(false);
    Object.assign(globalThis, previous);
    delete globalThis.rotationTestViews;
    dom.window.close();
  }
});
