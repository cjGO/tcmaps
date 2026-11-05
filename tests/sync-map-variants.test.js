import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVariantFiles, syncMapVariants } from '../scripts/sync-map-variants.mjs';

const document = count => JSON.stringify({ source: { sco_sha256: 'sco', recipe_sha256: 'recipe', terrain_code: 'terrain' }, placements: Array.from({ length: count }, (_, id) => ({ id })) });
test('sync imports direct exports, preserves app-only files and archives replaced revision bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'map-variant-sync-'));
  const source = path.join(root, 'MOD'), destination = path.join(root, 'app'), archivePath = path.join(root, 'archive.json');
  const write = async (base, file, raw) => { const target = path.join(base, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, raw); };
  const file = 'small/test_map_111/variants/test_map_111_AnnaFreud.placements.json';
  const other = 'small/test_map_111/variants/test_map_111_Local.placements';
  const short = 'tiny/test_map_176/variants/test_map_176_AnnaFreud.json';
  const args = { source, destination, archivePath };
  try {
    await write(source, file, document(218));
    await write(source, short, document(62));
    await write(source, 'small/test_map_111/builds/generated/placements.json', 'invalid');
    await write(source, file + ':Zone.Identifier', 'invalid');
    await write(destination, file, document(136));
    await write(destination, other, document(1));
    const before = await syncMapVariants({ ...args, check: true });
    assert.equal(before.changes.length, 2);
    assert.equal(await readFile(path.join(destination, file), 'utf8'), document(136));
    await syncMapVariants(args);
    assert.equal(await readFile(path.join(destination, file), 'utf8'), document(218));
    assert.equal(await readFile(path.join(destination, other), 'utf8'), document(1));
    assert.equal(Object.keys(await readVariantFiles(destination)).length, 3);
    const archive = JSON.parse(await readFile(archivePath, 'utf8'));
    const hash = createHash('sha256').update(document(136)).digest('hex');
    assert.equal(archive[`archive/${hash}/maps/${file}`], document(136));
    assert.deepEqual((await syncMapVariants({ ...args, check: true })).changes, []);
    await write(source, short, 'invalid');
    await write(source, file, document(300));
    await assert.rejects(syncMapVariants(args), SyntaxError);
    assert.equal(await readFile(path.join(destination, file), 'utf8'), document(218), 'Validate all incoming files before writing');
  } finally { await rm(root, { recursive: true, force: true }); }
});
