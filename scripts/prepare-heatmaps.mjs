import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { openEditorHeatArchive } from './editor-heat-data.mjs';
import { parseExperimentalJournal } from '../src/experimental-replay.js';
import { parseJournal } from '../src/tactical-replay.js';

const root = new URL('../', import.meta.url);
const replayRoot = new URL('replays/', root);
const output = new URL('public/replay-heat/', root);
const manifest = new URL('lib/replay-heat.json', root);
const heat = await openEditorHeatArchive(replayRoot);
let processed = 0, selected = 0;
for (const folder of ['replays/', 'experimental_replays/']) {
  const directory = new URL(folder, root);
  const files = await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const filename of files.sort()) {
    if (!/\.(?:jsonl|replay\.json)$/.test(filename)) continue;
    try {
      const text = await readFile(new URL(encodeURIComponent(filename), directory), 'utf8');
      const journal = filename.endsWith('.jsonl') ? text : JSON.parse(text).journal;
      const header = JSON.parse(journal.slice(0, journal.indexOf('\n')));
      if (heat.accepts(header)) {
        const experimental = header.schema === 'warband-experimental-replay';
        heat.add(experimental ? parseExperimentalJournal(journal) : parseJournal(journal), experimental);
        selected++;
      }
    } catch (error) {
      throw new Error(`Could not prepare heatmaps from ${folder}${filename}`, { cause: error });
    }
    if (++processed % 100 === 0) console.log(`Scanned ${processed} replay files`);
  }
}
if (!processed) throw new Error('No replay files found. Existing heatmaps were kept.');

const previous = JSON.parse(await readFile(manifest, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '{"maps":{}}';
  throw error;
}));
await mkdir(output, { recursive: true });
const maps = {};
for (const [id, data] of Object.entries(heat.finish())) {
  const json = JSON.stringify(data);
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
  const filename = `${id}-${hash}.json.gz`;
  const temporary = new URL(`${filename}.${process.pid}.tmp`, output);
  await writeFile(temporary, gzipSync(json));
  await rename(temporary, new URL(filename, output));
  maps[id] = { filename, bounds: data.bounds, variants: data.groups.map(group => group.variant) };
}
const temporary = new URL(`${manifest.href}.${process.pid}.tmp`);
await writeFile(temporary, JSON.stringify({ version: 1, maps }, null, 2) + '\n');
await rename(temporary, manifest);
const keep = new Set(Object.values(maps).map(map => map.filename));
for (const { filename } of Object.values(previous.maps)) {
  if (/^test_map_\d+-[\da-f]{16}\.json\.gz$/.test(filename) && !keep.has(filename)) {
    await rm(new URL(filename, output), { force: true });
  }
}
console.log(`Prepared ${Object.keys(maps).length} heatmaps from ${selected} matching replay files (${processed} scanned).`);
