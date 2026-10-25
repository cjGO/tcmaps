import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rotation = JSON.parse(await readFile(path.join(root, 'lib/editor-rotation.json'), 'utf8'));
const filenames = (await readdir(path.join(root, 'current_rotation'))).filter(n => /\.png$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!rotation.length || !isDeepStrictEqual(filenames, rotation.map(map => map.filename))) {
  throw new Error('Current rotation images differ from registered editor maps. Run scripts/prepare-editor.py with --module-root, then npm run prepare:editor (see README).');
}
for (const map of rotation) {
  if (hash(await readFile(path.join(root, 'current_rotation', map.filename))) !== map.imageSha256) {
    throw new Error(`Current rotation image changed: ${map.filename}. Sync registered editor maps again (see README).`);
  }
}
const manifestPath = path.join(root, 'lib/editor-maps.json');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isDeepStrictEqual(manifest.map(map => map.id), rotation.map(map => map.id))) {
    throw new Error('Published editor options differ from the registered current rotation. Run npm run prepare:editor.');
  }
  for (const [i, map] of manifest.entries()) {
    const registered = rotation[i];
    if (map.map_id !== registered.map_id || map.variant_id !== registered.variant_id || map.variant_revision !== registered.variant_revision || map.filename !== registered.filename || map.imageSha256 !== registered.imageSha256 || map.pool !== registered.pool) {
      throw new Error(`Published editor registration changed: ${map.id}. Run npm run prepare:editor.`);
    }
    for (const [key, expected] of [['project', map.projectSha256], ['heatmap', map.heatmapSha256]]) {
      if (hash(await readFile(path.join(root, 'public', map[key]))) !== expected) throw new Error(`Editor ${key} changed: ${map.filename}. Run npm run prepare:editor.`);
    }
    const project = JSON.parse(await readFile(path.join(root, 'public', map.project), 'utf8'));
    if (!isDeepStrictEqual(project.source, registered.source)) throw new Error('Published editor source differs from registered rotation: ' + map.id);
  }
  console.log(`Verified ${manifest.length} registered current-rotation editor projects.`);
} else {
  const manifest = [];
  for (const map of rotation) {
    const { id, map_id, variant_id, variant_revision, filename, pool, imageSha256 } = map;
    const projectDir = path.join(root, map.project);
    const projectBytes = await readFile(path.join(projectDir, 'project.json'));
    const project = JSON.parse(projectBytes);
    if (!isDeepStrictEqual(project.source, map.source) || !project.calibration || !project.assets.length) throw new Error('Invalid registered editor project: ' + id);
    for (const [file, expected] of [[project.source.sco_path, project.source.sco_sha256], [project.source.recipe_path, project.source.recipe_file_sha256], [path.join(projectDir, 'height_data.json'), project.height_data_sha256]]) {
      if (hash(await readFile(file)) !== expected) throw new Error('Prepared source changed: ' + file);
    }
    const heatmap = await readFile(path.join(projectDir, 'heatmap.png'));
    const projectSha256 = hash(projectBytes), heatmapSha256 = hash(heatmap);
    const directory = `editor/${id}/${hash(projectBytes + heatmapSha256).slice(0, 16)}`;
    await mkdir(path.join(root, 'public', directory), { recursive: true });
    await copyFile(path.join(projectDir, 'project.json'), path.join(root, 'public', directory, 'project.json'));
    await copyFile(path.join(projectDir, 'heatmap.png'), path.join(root, 'public', directory, 'heatmap.png'));
    manifest.push({ filename, id, map_id, variant_id, variant_revision, pool, imageSha256, projectSha256, heatmapSha256, project: `${directory}/project.json`, heatmap: `${directory}/heatmap.png` });
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Published ${manifest.length} registered current-rotation editor projects.`);
}
