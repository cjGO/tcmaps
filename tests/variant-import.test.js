import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { variantId, roundVariant, includedVariants } from '../src/map-variants.js';
import { replayVariantRegistry, recordingVariant } from '../src/replay-variants.js';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
const hash = raw => createHash('sha256').update(raw).digest('hex');

test('imported author names and recorded filenames keep their VarA history', () => {
  for (const number of [108, 111, 133, 176, 198, 199]) {
    const id = `test_map_${number}`;
    const size = number < 176 ? 'small' : number === 176 ? 'tiny' : 'medium';
    const filename = `${id}_AnnaFreud_VarA.placements.json`;
    const path = `maps/${size}/${id}/variants/${filename}`;
    const raw = read(path);
    const [variant] = includedVariants({ [path]: raw }, id);
    assert.equal(variant.id, 'vara');
    for (const old of [`${id}_AnnaFreud.placements.json`, ...(number === 176 ? [`${id}_VarA_AnnaFreud.json`] : [])]) {
      if (number === 176 && old.includes('_AnnaFreud.placements')) continue;
      assert.equal(variantId(old, id), variant.id);
      assert.equal(roundVariant(['map_name', 'variant_id'], [`${id}_VarA`, old], id), variant.id);
    }
    assert.equal(roundVariant(['map_name'], [`${id}_VarA`], id), variant.id);
    assert.equal(variantId('source', id), 'source');
  }
});

test('archived filename and checksum still select the exact old replay document', async () => {
  const current = json('lib/rotation-topology.json');
  const archive = json('lib/replay-variant-archive.json');
  const registry = await replayVariantRegistry(current, archive);
  for (const number of [108, 111, 176, 198, 199]) {
    const installed = current.maps.find(m => m.map_id === `test_map_${number}`);
    const selected = recordingVariant(installed, registry.variants);
    assert.ok(selected, installed.map_id);
    assert.equal(selected.revision, installed.variant_revision);
    assert.equal(hash(selected.raw), installed.variant_revision);
  }
});
