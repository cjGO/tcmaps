import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const filenames = (await readdir(path.join(root, 'goodmaps'))).filter(n => /\.png$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const check = process.argv.includes('--check');
const manifestPath = path.join(root, 'lib/editor-maps.json');
if (check) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const unpublished = filenames.filter(filename => !manifest.some(map => map.filename === filename));
  if (unpublished.length) console.warn(`Editor unavailable for ${unpublished.join(', ')}. Prepare and publish projects to enable editing (see README).`);
  const removed = manifest.filter(map => !filenames.includes(map.filename));
  if (removed.length) throw new Error(`Published editor maps are no longer in GOODMAPS: ${removed.map(map => map.filename).join(', ')}. Run npm run prepare:editor.`);
  for (const map of manifest) {
    if (hash(await readFile(path.join(root, 'goodmaps', map.filename))) !== map.imageSha256) throw new Error(`GOODMAPS image changed: ${map.filename}. Prepare its editor again.`);
    for (const [key, expected] of [['project', map.projectSha256], ['heatmap', map.heatmapSha256]]) {
      if (hash(await readFile(path.join(root, 'public', map[key]))) !== expected) throw new Error(`Editor ${key} changed: ${map.filename}. Run npm run prepare:editor.`);
    }
  }
  console.log(`Verified ${manifest.length} GOODMAPS editor projects.`);
} else {
  const manifest = [];
  for (const filename of filenames) {
    const id = filename.replace(/\.png$/i, '');
    const projectDir = path.join(root, 'map_editor/projects/goodmaps', id);
    const projectBytes = await readFile(path.join(projectDir, 'project.json'));
    const project = JSON.parse(projectBytes);
    if (project.source.scene_id !== id || !project.calibration || !project.assets.length) throw new Error('Invalid editor project: ' + id);
    // Publish only projects still tied to their original source and GOODMAPS PNG.
    const imageSha256 = hash(await readFile(path.join(root, 'goodmaps', filename)));
    if (hash(await readFile(project.source.sco_path.replace(/\.sco$/, '.png'))) !== imageSha256) throw new Error('Original GOODMAPS image changed: ' + id);
    for (const [file, expected] of [[project.source.sco_path, project.source.sco_sha256], [project.source.recipe_path, project.source.recipe_file_sha256], [path.join(projectDir, 'height_data.json'), project.height_data_sha256]]) {
      if (hash(await readFile(file)) !== expected) throw new Error('Prepared source changed: ' + file);
    }
    const heatmap = await readFile(path.join(projectDir, 'heatmap.png'));
    const projectSha256 = hash(projectBytes), heatmapSha256 = hash(heatmap);
    const directory = `editor/${id}/${hash(projectBytes + heatmapSha256).slice(0, 16)}`;
    await mkdir(path.join(root, 'public', directory), { recursive: true });
    await copyFile(path.join(projectDir, 'project.json'), path.join(root, 'public', directory, 'project.json'));
    await copyFile(path.join(projectDir, 'heatmap.png'), path.join(root, 'public', directory, 'heatmap.png'));
    manifest.push({ filename, id, imageSha256, projectSha256, heatmapSha256, project: `${directory}/project.json`, heatmap: `${directory}/heatmap.png` });
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Published ${manifest.length} GOODMAPS editor projects.`);
}
