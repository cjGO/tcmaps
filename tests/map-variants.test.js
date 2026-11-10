import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { variantId, roundVariant, includedVariants, assertVariantSource, defaultRotationVariant } from '../src/map-variants.js';
import { csvRows, parseMapNames, statsMapId } from '../src/map-identity.js';
// Freeze historical revisions used by replay tests; inbox updates replace active files.
const historicalVariants = JSON.parse(fs.readFileSync(new URL('./fixtures/variant-import-baseline.json', import.meta.url), 'utf8'));
const read = path => historicalVariants[path] ?? fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('map 116 RAW retains original terrain and spawns across variant switches', async () => {
  const { sourceTerrain, resolveVariantPreview } = await import('../src/rotation-variants.js');
  const { rotationSpawns } = await import('../src/rotation-spawns.js');
  const { groundHeight } = await import('../src/editor-spatial.js');
  const installed = JSON.parse(read('lib/rotation-topology.json')).maps.find(m => m.map_id === 'test_map_116');
  const archived = JSON.parse(read('lib/replay-topology.json')).maps;
  const source = sourceTerrain(installed, archived);
  assert.equal(source.variant_id, 'source');
  assert.notEqual(source.url, installed.url);
  const originalData = JSON.parse(read('public' + source.url));
  const installedData = JSON.parse(read('public' + installed.url));
  const originalSnapshot = structuredClone(originalData.spawns);
  const path = 'maps/small/test_map_116/variants/test_map_116_VarA.placements.json';
  const [variant] = includedVariants({ [path]: read(path) }, installed.map_id);
  const preview = await resolveVariantPreview(variant, installed, archived);
  for (let switchCount = 0; switchCount < 2; switchCount++) {
    const active = rotationSpawns(installedData, preview, installed);
    assert.equal(active.spawns[0].x_m, 252.352);
    assert.equal(active.spawns[1].x_m, 284.122);
    assert.equal(active.spawns[0].z_m, groundHeight(installedData, 252.352, 92.769));
    assert.match(active.note, /Variant spawns · VarA/);
    assert.match(active.note, /Original defaults saved with this variant/);
    const raw = rotationSpawns(originalData, null, source, true);
    assert.deepEqual(raw.spawns, originalSnapshot);
    assert.equal(raw.spawns[0].x_m.toFixed(3), '124.800');
    assert.equal(raw.spawns[1].x_m.toFixed(3), '595.200');
    assert.match(raw.note, /Source \/ RAW original spawns/);
    assert.doesNotMatch(raw.note, /Variant spawns/);
  }
  assert.deepEqual(originalData.spawns, originalSnapshot);
  assert.deepEqual(variant.document, JSON.parse(read(path)));
  const legacy = rotationSpawns(originalData, { variant: { document: { version: 2 } } }, source);
  assert.deepEqual(legacy.spawns, originalSnapshot, 'Legacy files use the measured scene spawns');
  assert.match(legacy.note, /Measured scene spawns/);
  assert.equal(sourceTerrain(source, []), source);
  assert.throws(() => sourceTerrain(installed, []), /unavailable or ambiguous/);
  assert.throws(() => sourceTerrain(installed, [{ ...source, map_id: 'test_map_117' }]), /unavailable or ambiguous/);
  assert.throws(() => sourceTerrain(installed, [source, { ...source, sha256: 'another-revision' }]), /ambiguous/);
});

test('rotation defaults prefer installed placements, then another available variant', () => {
  const variants = [{ id: 'stats-only' }, { id: 'a', document: {} }, { id: 'b', document: {} }];
  assert.equal(defaultRotationVariant(variants, { map_id: 'test_map_176', variant_id: 'test_map_176_b.json' }), 'b');
  assert.equal(defaultRotationVariant(variants, { variant_id: 'source' }), 'a');
  assert.equal(defaultRotationVariant(variants), 'a');
  assert.equal(defaultRotationVariant([{ id: 'stats-only' }]), 'source');
  assert.equal(defaultRotationVariant([]), 'source');
});

test('replay inference uses recorded evidence and leaves ambiguous revisions for manual selection', async () => {
  const { inferRecordingVariant, replayPlacementDocument, replayMapIdentity } = await import('../src/replay-variants.js');
  const source = { sco_sha256: 'scene', recipe_sha256: 'recipe', terrain_code: 'terrain' };
  const variant = { map_id: 'test_map_176', id: 'vara', revision: 'a', document: { source: {}, placements: [] }, registrations: [{ source }] };
  const second = { ...variant, revision: 'b', registrations: [] };
  const map = { map_id: 'test_map_176', kind: 'fixed' };
  assert.equal(replayMapIdentity({ source }, [{ ...map, source }]).map_id, map.map_id);
  assert.equal(replayMapIdentity({ source }, [{ ...map, source }, { map_id: 'test_map_177', source }]).map_id, undefined);
  assert.equal(replayMapIdentity({ id: 'reused_scene_slot' }, [{ ...map, id: 'reused_scene_slot', source }]).map_id, undefined);
  const infer = patch => inferRecordingVariant({ ...map, ...patch }, [variant, second]).variant;
  assert.equal(infer({ variant_revision: 'a' }), variant);
  assert.equal(infer({ source }), variant);
  assert.equal(infer({ variant_id: 'VarA' }), null, 'Two revisions of the same name are ambiguous');
  assert.equal(infer({}), null, 'Family alone does not identify placements');
  assert.equal(infer({ variant_revision: 'missing', source }), null, 'Do not replace a missing recorded revision');
  assert.equal(infer({ variant_id: 'RAW', source }), null);
  assert.equal(inferRecordingVariant({ ...map, map_name: 'test_map_176_VarA' }, [variant]).variant, variant);
  assert.deepEqual(replayPlacementDocument(variant, { source }).placements, []);
  assert.throws(() => replayPlacementDocument(variant, { source: {} }), /differs/);
  assert.deepEqual(replayPlacementDocument(variant, { source: {} }, true).source, {});
  assert.deepEqual(variant.document.source, {}, 'Preview leaves saved placement provenance unchanged');
});

test('variant identity unifies exported filenames, recorded names, and source aliases', () => {
  for (const value of ['VarA', 'test_map_116_VarA', 'test_map_116_VarA.placements.json', 'test_map_116_VarA.placements', 'test_map_116_VarA.json']) assert.equal(variantId(value, 'test_map_116'), 'vara');
  for (const value of ['', 'source', 'RAW', 'test_map_116_RAW']) assert.equal(variantId(value, 'test_map_116'), 'source');
  const headers = ['map_name', 'variant_id'];
  assert.equal(roundVariant(headers, ['test_map_116_VarA', ''], 'test_map_116'), 'vara');
  assert.equal(roundVariant(headers, ['test_map_116', 'village.json'], 'test_map_116'), 'village');
  assert.equal(roundVariant(headers, ['mp_custom_map_21', 'source'], 'test_map_116'), 'source');
});

test('rotation variants use installed revision evidence or exact archived terrain, never family alone', async () => {
  const { resolveVariantPreview, installedVariantPreview, assertPlacementSource } = await import('../src/rotation-variants.js');
  const current = JSON.parse(read('lib/rotation-topology.json')).maps;
  const archived = JSON.parse(read('lib/replay-topology.json')).maps;
  const path = 'maps/medium/test_map_199/variants/test_map_199_AnnaFreud.placements.json';
  const [variant] = includedVariants({ [path]: read(path) }, 'test_map_199');
  const installed = current.find(m => m.map_id === variant.map_id);
  assert.throws(() => assertVariantSource(variant.document, installed), /revision/);
  const preview = await resolveVariantPreview(variant, installed, archived);
  assert.equal(preview.terrain, installed);
  assert.equal(preview.registration, installed);
  assertPlacementSource(variant.document, installed, preview);
  assert.throws(() => assertPlacementSource(variant.document, installed, { ...preview, revision: 'wrong' }), /revision/);
  assert.throws(() => assertPlacementSource(variant.document, current[0], preview), /revision/);
  assert.equal(await resolveVariantPreview(variant, { ...installed, variant_revision: 'wrong' }, archived), null);
  assert.equal(await resolveVariantPreview({ ...variant, map_id: 'test_map_111' }, installed, archived), null);
  assert.equal((await installedVariantPreview([variant], installed)).variant, variant);

  const updated = 'maps/small/test_map_111/variants/test_map_111_AnnaFreud.placements.json';
  const variants = includedVariants({ [updated]: read(updated) }, 'test_map_111');
  assert.equal(variants.length, 1);
  const map111 = current.find(m => m.map_id === 'test_map_111');
  const newer = variants.find(v => v.id === variantId(updated, 'test_map_111'));
  const updatedPreview = await resolveVariantPreview(newer, map111, archived);
  assert.notEqual(updatedPreview.terrain, map111);
  assert.equal(updatedPreview.registration, null);
  assert.equal(newer.document.placements.length, 218);
  assertPlacementSource(newer.document, updatedPreview.terrain, updatedPreview);
  assert.equal(await installedVariantPreview(variants, map111), null, 'The installed older revision is archived, not selectable');
  const { replayVariantRegistry, recordingVariant } = await import('../src/replay-variants.js');
  const replay = await replayVariantRegistry({ maps: archived }, {
    [updated]: read(updated), ...JSON.parse(read('lib/replay-variant-archive.json')),
  });
  const historical = archived.find(row => row.map_id === map111.map_id && replay.variants.some(v => v.revision === row.variant_revision && v.document.placements.length === 136));
  assert.ok(historical, 'The original installed revision remains archived');
  const saved = recordingVariant(historical, replay.variants);
  assert.equal(saved.document.placements.length, 136, 'Replacing a file must preserve the original replay identity and revision');
});

test('equivalent filename extensions have one selector option and retain distinct replay revisions', () => {
  const path = 'maps/tiny/test_map_176/variants/test_map_176_VarA_AnnaFreud.placements.json';
  const raw = read(path), alternate = path.replace('.placements.json', '.json');
  assert.equal(includedVariants({ [path]: raw, [alternate]: raw }, 'test_map_176').length, 1);
  assert.equal(includedVariants({ [path]: raw, [alternate]: raw + '\n' }, 'test_map_176').length, 2);
});

test('included VarA matches measured terrain, assets, and its recorded rounds', () => {
  const path = 'maps/small/test_map_116/variants/test_map_116_VarA.placements.json';
  const document = JSON.parse(read(path.replace('VarA.placements', 'VarA_3l3ct.placements')));
  const variants = includedVariants({ [path]: document }, 'test_map_116');
  assert.equal(variants.length, 1);
  assert.equal(variants[0].id, 'vara');
  assert.equal(includedVariants({ [path]: document }, 'test_map_117').length, 0);
  const terrain = JSON.parse(read('lib/replay-topology.json')).maps.find(m => m.map_id === 'test_map_116');
  assertVariantSource(document, terrain);
  const installed = JSON.parse(read('lib/rotation-topology.json')).maps.find(m => m.map_id === 'test_map_116');
  assert.throws(() => assertVariantSource(document, installed), /revision/);
  assert.throws(() => assertVariantSource({ source: { ...document.source, sco_sha256: 'different' } }, terrain), /revision/);
  const models = JSON.parse(read('lib/editor-models.json'));
  const assets = JSON.parse(read('public' + models.manifest_url)).assets;
  assert.equal(document.placements.length, 138);
  for (const point of document.placements) assert.ok(assets[point.asset], point.asset);
  const [headers, ...rows] = csvRows(read('map_round_stats.csv'));
  const names = parseMapNames(read('MAPNAMES.md'));
  const family = rows.filter(row => statsMapId(names, row[0]) === 'test_map_116');
  const variant = family.filter(row => roundVariant(headers, row, 'test_map_116') === 'vara');
  assert.ok(variant.length >= 4);
  assert.ok(family.length > variant.length);
});

test('recorded VarA revision selects its assets and terrain for both replay versions', async () => {
  const { replayVariantRegistry, recordingVariant, replayTerrainManifest } = await import('../src/replay-variants.js');
  const { recordingTerrainOverlay, parseRecording } = await import('../src/tactical-replay.js');
  const { terrainOverlayCandidate, verifyExperimentalTerrain } = await import('../src/experimental-replay.js');
  const path = 'maps/small/test_map_116/variants/test_map_116_VarA.placements.json';
  const current = JSON.parse(read('lib/rotation-topology.json'));
  const archived = JSON.parse(read('lib/replay-topology.json'));
  const files = { [path]: read(path.replace('VarA.placements', 'VarA_3l3ct.placements')) };
  const currentOnly = await replayVariantRegistry(current, files);
  assert.equal(currentOnly.variants.length, 1, 'Installed checksum identifies placements on the compiled terrain');
  assert.equal(currentOnly.manifest.maps.filter(m => m.placement_overlay).length, 0, 'Compiled terrain needs no historical overlay');
  const registry = await replayVariantRegistry(replayTerrainManifest(current, archived), files);
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
  for (const patch of [{ map_id: 'test_map_117' }, { variant_id: 'source' }, { variant_revision: '0'.repeat(64) }, { available: false }]) {
    assert.equal(recordingVariant({ ...header.map, ...patch }, registry.variants), null);
  }
  assert.equal(recordingVariant({ ...header.map, variant_id: 'VarA' }, registry.variants), variant);
  assert.equal(recordingVariant({ ...header.map, variant_revision: false }, registry.variants), variant);
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

test('map 176 VarA is discoverable and matches its terrain and model assets', () => {
  const path='maps/tiny/test_map_176/variants/test_map_176_VarA_AnnaFreud.placements.json';
  const document=JSON.parse(read(path));
  const [variant]=includedVariants({[path]:document},'test_map_176');
  assert.equal(variant.id,variantId(path,'test_map_176'));
  const terrain=JSON.parse(read('lib/replay-topology.json')).maps.find(m=>m.map_id==='test_map_176');
  assertVariantSource(document,terrain);
  const models=JSON.parse(read('lib/editor-models.json'));
  const assets=JSON.parse(read('public'+models.manifest_url)).assets;
  assert.ok(document.placements.length>0);
  for (const point of document.placements) assert.ok(assets[point.asset],point.asset);
});
