import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const source = path.resolve(process.argv[2] && process.argv[2] !== '--if-present' ? process.argv[2] : 'temp_folder');
let sourceFiles;
try {
  sourceFiles = await readdir(source);
} catch (error) {
  if (error.code !== 'ENOENT' || !process.argv.includes('--if-present')) throw error;
  console.log('No temp_folder; using the prepared maps.');
  process.exit(0);
}
await mkdir('public/maps', { recursive: true });
const maps = new Map();
const files = sourceFiles.filter(f => f.endsWith('.png')).sort();
if (!files.length) throw new Error(`No PNG maps found in ${source}`);
async function prepare(file) {
  const match = file.match(/^(scn_test_\d+).*?__(\d+)_(.+)\.png$/);
  if (!match) throw new Error(`Unexpected filename: ${file}`);
  const [, id, order, spawn] = match;
  if (!maps.has(id)) maps.set(id, { id, name: `Map ${id.match(/\d+$/)[0]}`, spawns: [] });
  const filename = `${id}__${spawn}.webp`;
  const buffer = await sharp(path.join(source, file)).resize(1200, 1200, { withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const version = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  await writeFile(`public/maps/${filename}`, buffer);
  maps.get(id).spawns.push({ id: spawn, label: spawn.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()), order: Number(order), image: `/maps/${filename}?v=${version}` });
}
for (let i = 0; i < files.length; i += 4) {
  await Promise.all(files.slice(i, i + 4).map(prepare));
  if (i % 100 === 0) console.log(`Preparing images: ${i}/${files.length}`);
}
for (const map of maps.values()) map.spawns.sort((a, b) => a.order - b.order);
await writeFile('lib/maps.json', JSON.stringify([...maps.values()], null, 2) + '\n');
console.log(`Prepared ${files.length} images across ${maps.size} maps.`);
