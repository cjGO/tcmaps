import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { variantId, roundVariant, includedVariants, assertVariantSource } from '../src/map-variants.js';
import { csvRows, parseMapNames, statsMapId } from '../src/map-identity.js';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('variant identity unifies exported filenames, recorded names, and source aliases', () => {
  for (const value of ['VarA', 'test_map_116_VarA', 'test_map_116_VarA.placements.json']) assert.equal(variantId(value, 'test_map_116'), 'vara');
  for (const value of ['', 'source', 'RAW', 'test_map_116_RAW']) assert.equal(variantId(value, 'test_map_116'), 'source');
  const headers = ['map_name', 'variant_id'];
  assert.equal(roundVariant(headers, ['test_map_116_VarA', ''], 'test_map_116'), 'vara');
  assert.equal(roundVariant(headers, ['test_map_116', 'village.json'], 'test_map_116'), 'village');
  assert.equal(roundVariant(headers, ['mp_custom_map_21', 'source'], 'test_map_116'), 'source');
});

test('included VarA matches measured terrain, assets, and its four recorded rounds', () => {
  const path = 'maps/small/test_map_116/variants/test_map_116_VarA.placements.json';
  const document = JSON.parse(read(path));
  const variants = includedVariants({ [path]: document }, 'test_map_116');
  assert.equal(variants.length, 1);
  assert.equal(variants[0].id, 'vara');
  assert.equal(includedVariants({ [path]: document }, 'test_map_117').length, 0);
  const terrain = JSON.parse(read('lib/rotation-topology.json')).maps.find(m => m.map_id === 'test_map_116');
  assertVariantSource(document, terrain);
  assert.throws(() => assertVariantSource({ source: { ...document.source, sco_sha256: 'different' } }, terrain), /revision/);
  const models = JSON.parse(read('lib/editor-models.json'));
  const assets = JSON.parse(read('public' + models.manifest_url)).assets;
  assert.equal(document.placements.length, 138);
  for (const point of document.placements) assert.ok(assets[point.asset], point.asset);
  const [headers, ...rows] = csvRows(read('map_round_stats.csv'));
  const names = parseMapNames(read('MAPNAMES.md'));
  const family = rows.filter(row => statsMapId(names, row[0]) === 'test_map_116');
  const variant = family.filter(row => roundVariant(headers, row, 'test_map_116') === 'vara');
  assert.equal(variant.length, 4);
  assert.ok(family.length > variant.length);
});

test('recorded VarA revision selects its assets and terrain for both replay versions', async () => {
  const { replayVariantRegistry, recordingVariant } = await import('../src/replay-variants.js');
  const { recordingTerrainOverlay, parseRecording } = await import('../src/tactical-replay.js');
  const { terrainOverlayCandidate, verifyExperimentalTerrain } = await import('../src/experimental-replay.js');
  const path = 'maps/small/test_map_116/variants/test_map_116_VarA.placements.json';
  const registry = await replayVariantRegistry(JSON.parse(read('lib/rotation-topology.json')), { [path]: read(path) });
  const header = JSON.parse(read('experimental_replays/EXP-20261030T151732Z-1.jsonl').split('\n')[0]);
  const original = structuredClone(header.map);
  const variant = recordingVariant(header.map, registry.variants);
  assert.equal(variant.document.placements.length, 138);
  assert.equal(variant.revision, header.map.variant_revision);
  const entry = terrainOverlayCandidate({ header }, registry.manifest.maps);
  assert.ok(entry);
  assert.equal(recordingTerrainOverlay(header.map, registry.manifest.maps), entry);
  const result = await verifyExperimentalTerrain({ header }, JSON.parse(read('public' + entry.url)), entry, 'map-id');
  assert.equal(result.verified, false, 'Compiled map source differs; retain the overlay notice');
  assert.deepEqual(header.map, original);
  for (const patch of [{ map_id: 'test_map_117' }, { variant_id: 'source' }, { variant_revision: '0'.repeat(64) }, { variant_revision: false }, { available: false }]) {
    assert.equal(recordingVariant({ ...header.map, ...patch }, registry.variants), null);
  }
  assert.equal(recordingVariant({ ...header.map, variant_id: 'VarA' }, registry.variants), variant);
  assert.equal(recordingVariant(header.map, []), null);
  // Exercise the stable parser with an explicitly synthetic variant journal.
  const bundle = JSON.parse(read('replays/20261024T191232Z-27-3-2.replay.json'));
  const lines = bundle.journal.trim().split('\n');
  const stableHeader = JSON.parse(lines[0]);
  stableHeader.id = 'SYNTHETIC-VarA-assets'; stableHeader.synthetic = true; stableHeader.map = header.map;
  lines[0] = JSON.stringify(stableHeader);
  const stable = await parseRecording(lines.join('\n') + '\n', { manifest: registry.manifest, loadTerrain: async url => read('public' + url) });
  assert.equal(stable.terrainMatch, 'unverified-map-id');
  assert.equal(recordingVariant(stable.replay.header.map, registry.variants), variant);

});
