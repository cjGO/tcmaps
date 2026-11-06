import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ entryPoints: ['src/replay-variant-control.js'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /replay-variant-assets\.js$|rotation-variant-layer\.js$/ }, a => ({ path: a.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path.includes('assets')
    ? 'export const replayAssets = Promise.resolve(globalThis.variantFixture);'
    : 'export function createVariantLayer(viewer, data, doc) { viewer.documents.push(doc); return { ready: Promise.resolve(), dispose() { viewer.disposals++; } }; }' }));
} }] });

test('replay selector preserves manual choices per recording and exports the displayed placements', async () => {
  const dom = new JSDOM('<section></section>');
  globalThis.document = dom.window.document; globalThis.Option = dom.window.Option;
  const source = { sco_sha256: 's', recipe_sha256: 'r', terrain_code: 't' };
  const variants = ['a', 'b'].map(revision => ({ map_id: 'test_map_176', id: 'vara', label: 'VarA', revision, document: { source, placements: [{ id: revision }] } }));
  globalThis.variantFixture = { variants, manifest: { maps: [{ map_id: 'test_map_176', source }] } };
  const { createReplayVariantControl } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const host = document.querySelector('section'), control = createReplayVariantControl(host);
  const viewer = { documents: [], disposals: 0, updateSpawns() {} }, data = { source, spawns: [] }, map = { map_id: 'test_map_176' };
  const change = async value => {
    const select = host.querySelector('select'); select.value = value;
    select.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  try {
    await control.attach(viewer, data, { source }, 'one');
    assert.equal(host.querySelectorAll('option').length, 4);
    assert.equal(control.document, null);
    await change('b');
    assert.equal(control.document.placements[0].id, 'b');
    assert.match(host.textContent, /Manual variant overlay/);
    await control.attach(viewer, data, { ...map, variant_revision: 'a' }, 'two');
    assert.equal(control.document.placements[0].id, 'a');
    assert.equal(host.querySelector('select').value, 'a', 'The inferred revision is visibly selected');
    assert.match(host.textContent, /Recorded variant checksum matched/);
    await control.attach(viewer, data, { ...map, variant_revision: 'b' }, 'three');
    assert.equal(host.querySelector('select').value, 'b', 'Another replay selects its own recorded variant');
    assert.equal(control.document.placements[0].id, 'b');
    await control.attach(viewer, data, map, 'one');
    assert.equal(control.document.placements[0].id, 'b');
    await change('none');
    assert.equal(control.document, null);
    control.detach();
    assert.equal(host.querySelector('label').hidden, true);
    assert.ok(viewer.disposals >= 3);
  } finally {
    control.detach(); dom.window.close();
    delete globalThis.document; delete globalThis.Option; delete globalThis.variantFixture;
  }
});
