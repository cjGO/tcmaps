import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { editorVariantDocument } from '../src/editor-variant.js';
import coordinates from '../map_editor/web/coordinates.js';
import { includedVariants } from '../src/map-variants.js';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('latest map 111 loadout edits through checksum-verified archived input provenance', async () => {
  const map = (await json('lib/editor-maps.json')).find(row => row.map_id === 'test_map_111');
  const project = await json('public/' + map.project);
  const registration = (await json('lib/rotation-topology.json')).maps.find(row => row.id === map.id);
  const directory = 'maps/small/test_map_111/variants/';
  const files = {};
  for (const name of await readdir(new URL(directory, root))) {
    if (/\.(json|placements)$/.test(name)) files[directory + name] = await readFile(new URL(directory + name, root), 'utf8');
  }
  const variants = includedVariants(files, map.map_id);
  assert.equal(variants.length, 1, 'Only the latest loadout is selectable');
  const [variant] = variants;
  assert.equal(variant.id, 'annafreud');
  const archive = includedVariants(await json('lib/replay-variant-archive.json'), map.map_id);
  const document = await editorVariantDocument(variant, registration, project, archive);
  assert.equal(document.placements.length, 218);
  assert.deepEqual(coordinates.validate(document, project), variant.document.placements);
  assert.deepEqual(coordinates.validateSettings(document), variant.document.settings);
  assert.deepEqual(coordinates.validateSpawns(document, project), variant.document.spawn_points);
  assert.deepEqual(document.default_spawn_points, project.default_spawn_points);
  assert.notDeepEqual(variant.document.source, project.source, 'Original provenance is preserved');
  await assert.rejects(editorVariantDocument(variant, registration, project), /different map/);
  await assert.rejects(editorVariantDocument(variant, { ...registration, variant_revision: 'wrong' }, project, archive), /different map/);
  await assert.rejects(editorVariantDocument({ ...variant, map_id: 'test_map_112' }, registration, project, archive), /different map/);
  const changed = structuredClone(variant.document);
  changed.source.sco_sha256 = 'different';
  await assert.rejects(editorVariantDocument({ ...variant, raw: JSON.stringify(changed) }, registration, project, archive), /revision/);
  await assert.rejects(editorVariantDocument(variant, registration, { ...project, source: {} }, archive), /revision/);
});

test('installed map 176 loadout keeps all placements, settings and spawns when opened for editing', async () => {
  const maps = await json('lib/editor-maps.json');
  const map = maps.find(map => map.map_id === 'test_map_176');
  const project = await json('public/' + map.project);
  const registration = (await json('lib/rotation-topology.json')).maps.find(row => row.id === map.id);
  const raw = await readFile(new URL('maps/tiny/test_map_176/variants/test_map_176_VarA_AnnaFreud.json', root), 'utf8');
  const original = JSON.parse(raw);
  const variant = { map_id: map.map_id, raw, document: original };
  assert.throws(() => coordinates.validate(original, project), /different map/);
  const document = await editorVariantDocument(variant, registration, project);
  assert.equal(document.placements.length, 62);
  assert.deepEqual(coordinates.validate(document, project), original.placements);
  assert.deepEqual(coordinates.validateSettings(document), original.settings);
  assert.deepEqual(coordinates.validateSpawns(document, project), original.spawn_points);
  assert.deepEqual(document.source, project.source);
  assert.deepEqual(document.default_spawn_points, project.default_spawn_points);
  assert.deepEqual(variant.document, JSON.parse(raw), 'The original export remains unchanged');
  await assert.rejects(editorVariantDocument({ ...variant, map_id: 'test_map_177' }, registration, project), /different map/);
  await assert.rejects(editorVariantDocument({ ...variant, raw: raw + ' ' }, registration, project), /different map/);
  await assert.rejects(editorVariantDocument(variant, registration, { ...project, source: { ...project.source, sco_sha256: 'wrong' } }), /revision/);
});

test('editor options exactly match registered current rotation and source versions', async () => {
  const rotation = await json('lib/editor-rotation.json');
  const published = await json('lib/editor-maps.json');
  const terrain = await json('lib/rotation-topology.json');
  const models = await json('lib/editor-models.json');
  const filenames = (await readdir(new URL('current_rotation/', root))).filter(f => /\.png$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assert.ok(rotation.length > 0);
  assert.equal(new Set(rotation.map(map => map.id)).size, rotation.length);
  assert.deepEqual(rotation.map(map => map.filename), filenames);
  assert.deepEqual(published.map(map => map.id), rotation.map(map => map.id));
  assert.deepEqual(terrain.maps.map(map => map.id), rotation.map(map => map.id));
  assert.deepEqual(models.maps.map(map => map.id), rotation.map(map => map.id));
  assert.equal(terrain.map_count, rotation.length);
  for (const [i, map] of published.entries()) {
    const registered = rotation[i];
    assert.equal(map.filename, registered.filename);
    assert.equal(map.pool, registered.pool);
    assert.equal(map.imageSha256, hash(await readFile(new URL('current_rotation/' + map.filename, root))));
    const bytes = await readFile(new URL('public/' + map.project, root));
    assert.equal(map.projectSha256, hash(bytes));
    assert.deepEqual(JSON.parse(bytes).source, registered.source);
    assert.equal(map.heatmapSha256, hash(await readFile(new URL('public/' + map.heatmap, root))));
  }
});
