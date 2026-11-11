import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const optionalRead = async file => {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

// Only direct exports are candidates. Never ingest generated builds, source
// scenes, Windows download metadata, or unrelated JSON files.
export async function readVariantFiles(directory) {
  const files = {};
  for (const pool of await readdir(directory, { withFileTypes: true })) {
    if (!pool.isDirectory() || !['tiny', 'small', 'medium', 'large'].includes(pool.name)) continue;
    for (const map of await readdir(path.join(directory, pool.name), { withFileTypes: true })) {
      if (!map.isDirectory() || !/^test_map_\d+$/.test(map.name)) continue;
      const folder = path.join(pool.name, map.name, 'variants');
      let entries;
      try { entries = await readdir(path.join(directory, folder), { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !/\.(?:json|placements)$/i.test(entry.name)) continue;
        const relative = path.join(folder, entry.name);
        if (!entry.name.startsWith(map.name + '_')) throw new Error(`Variant filename must identify its map: ${relative}`);
        const raw = await readFile(path.join(directory, relative), 'utf8');
        const document = JSON.parse(raw);
        if (!Array.isArray(document.placements) || !['sco_sha256', 'recipe_sha256', 'terrain_code'].every(key => document.source?.[key])) {
          throw new Error(`Invalid placement document: ${relative}`);
        }
        files[relative.split(path.sep).join('/')] = raw;
      }
    }
  }
  return files;
}

export async function syncMapVariants({ source, destination, archivePath, check = false }) {
  const files = await readVariantFiles(source);
  if (!Object.keys(files).length) throw new Error('No variant exports found in ' + source);
  const archive = JSON.parse(await optionalRead(archivePath) || '{}');
  const changes = [];
  for (const [relative, raw] of Object.entries(files)) {
    const previous = await optionalRead(path.join(destination, relative));
    if (previous === raw) continue;
    if (previous !== null) {
      // Preserve the old filename AND exact bytes so historical replays still
      // resolve their recorded variant revision after a loadout is updated.
      JSON.parse(previous);
      archive[`archive/${hash(previous)}/maps/${relative}`] = previous;
    }
    changes.push({ relative, raw });
  }
  if (!check && changes.length) {
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, JSON.stringify(archive, null, 2) + '\n');
    for (const { relative, raw } of changes) {
      const target = path.join(destination, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, raw);
    }
  }
  return { files: Object.keys(files).length, changes: changes.map(change => change.relative) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'module-root': { type: 'string' }, check: { type: 'boolean' } } });
  if (!values['module-root']) throw new Error('Usage: npm run sync:variants -- --module-root <MOD> [--check]');
  const result = await syncMapVariants({ source: path.resolve(values['module-root'], 'custom_maps/random_maps/maps'), destination: path.join(root, 'maps'), archivePath: path.join(root, 'lib/replay-variant-archive.json'), check: values.check });
  console.log(`${result.files} MOD variant files; ${result.changes.length} ${values.check ? 'pending' : 'synchronized'} changes. App-only variants retained.`);
  for (const file of result.changes) console.log(file);
  if (values.check && result.changes.length) process.exitCode = 1;
}
