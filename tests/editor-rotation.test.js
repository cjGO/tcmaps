import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

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
