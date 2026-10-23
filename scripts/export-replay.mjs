import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseJournal, parseBundle, sourceEqual, MAX_BYTES } from '../src/tactical-replay.js';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--journal', '--manifest', '--asset-root', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/export-replay.mjs --journal PATH --output NEW.replay.json [--manifest archived-manifest.json --asset-root public]');
  options[args[i].slice(2)] = args[i + 1];
}
if (!options.journal || !options.output) throw new Error('--journal and --output are required');
if (fs.statSync(options.journal).size > MAX_BYTES) throw new Error('Journal exceeds 64 MiB');
const journal = fs.readFileSync(options.journal, 'utf8'), replay = parseJournal(journal);
if (replay.header.map.kind !== 'fixed') throw new Error('Generated terrain: 3D unavailable until the exact /savemap recipe has a verified measured topology export. Preserve the journal.');
const manifestPath = options.manifest || path.join(site, 'lib/rotation-topology.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schema_version !== 1 || !Array.isArray(manifest.maps)) throw new Error('Unsupported topology manifest');
const match = manifest.maps.find(m => sourceEqual(m.source, replay.header.map.source));
if (!match) throw new Error('No exact source version in topology manifest. Use its archived manifest/assets; never substitute a reused slot.');
const root = path.resolve(options['asset-root'] || path.join(site, 'public'));
if (typeof match.url !== 'string' || !/^\/topology\/[A-Za-z0-9_/-]+\.json$/.test(match.url)) throw new Error('Invalid terrain asset path');
const terrainPath = path.resolve(root, '.' + match.url);
if (!terrainPath.startsWith(root + path.sep) || fs.statSync(terrainPath).size > 8 * 1024 * 1024) throw new Error('Invalid terrain asset');
const terrain_json = fs.readFileSync(terrainPath, 'utf8');
const terrain_sha256 = crypto.createHash('sha256').update(terrain_json).digest('hex');
if (terrain_sha256 !== match.sha256) throw new Error('Topology asset checksum differs from its manifest');
const output = JSON.stringify({ schema: 'warband-replay-bundle', version: 1, journal, terrain_json, terrain_sha256 });
await parseBundle(output);
fs.writeFileSync(options.output, output + '\n', { flag: 'wx' });
console.log(`Exported ${replay.sampleCount} snapshots; ${replay.incomplete ? 'INCOMPLETE, recoverable prefix' : replay.end.reason}; terrain ${terrain_sha256}.`);
