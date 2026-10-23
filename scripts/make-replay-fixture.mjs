import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { groundHeight } from '../src/editor-spatial.js';
import { parseJournal } from '../src/tactical-replay.js';
const manifest = JSON.parse(fs.readFileSync('lib/rotation-topology.json', 'utf8'));
const map = manifest.maps[0], terrain = JSON.parse(fs.readFileSync(path.join('public', map.url), 'utf8'));
const version = crypto.createHash('sha256').update(`${map.source.sco_sha256}:${map.source.recipe_sha256}`).digest('hex');
const rows = [{ type: 'header', schema: 'warband-tactical-replay', version: 1, id: 'SYNTHETIC-tactical-demo-v1', synthetic: true,
  created_utc: '2026-10-23T00:00:00Z', map: { id: map.id, kind: 'fixed', source: map.source, version }, round_id: 'synthetic:1',
  round_start_ms: 0, round_max_ms: 600000, start_ms: 20000, start_offset_ms: 20000, sample_interval_ms: 5000,
  clock: 'mission_timer_a', clock_resolution_ms: 1000, position_units: 'centimetres', facing_units: 'millidegrees_clockwise_from_positive_y', complete: false }];
const meta = id => ({ team: id % 2, kind: id % 40 === 0 ? 'player' : 'bot', owner: 1 + id % 4, controller: id % 40 === 0 ? 1 + id % 4 : false, troop: id < 250 ? 10 : 20, class: id < 250 ? 0 : 4 });
for (let id = 1; id <= 320; id++) rows.push({ type: 'entity', t: 20000, id, origin: 'observed', ...meta(id) });
let samples = 0;
const b = terrain.bounds, cx = (b.x_max_m + b.x_min_m) / 2, cy = (b.y_max_m + b.y_min_m) / 2;
for (let t = 20000; t <= 120000; t += 5000) {
  if (t > 80000 && t < 110000) continue;
  if (t === 30000) rows.push({ type: 'change', t, id: 1, ...meta(1), kind: 'player', controller: 7 });
  if (t === 45000) for (let id = 2; id <= 30; id++) rows.push({ type: 'remove', t, id, reason: 'death', position: 'last_sample' });
  if (t === 60000) rows.push({ type: 'entity', t, id: 321, origin: 'spawn', ...meta(2) });
  const p = [];
  for (let id = 1; id <= (t >= 60000 ? 321 : 320); id++) {
    if (t >= 45000 && id >= 2 && id <= 30) continue;
    const direction = id % 2 ? -1 : 1, progress = (t - 20000) / 100000;
    const cavalry = id >= 250 && id <= 320;
    const x = cx + (id % 16 - 8) * 6 + (cavalry ? 130 * Math.sin(progress * 3) : 0);
    const y = cy + direction * (130 - progress * 160) + (Math.floor(id / 16) % 8) * 4;
    p.push([id, Math.round(x * 100), Math.round(y * 100), Math.round(groundHeight(terrain, x, y) * 100),
      (Math.round((id % 2 ? 359 + progress * 4 : 180) * 1000) + 360000) % 360000, cavalry && !(id === 250 && t >= 45000) ? 1 : 0]);
  }
  rows.push({ type: 'sample', t, p }); samples++;
}
rows.push({ type: 'end', t: 120000, complete: true, reason: 'round_end', result: 0, round_start_ms: 0, round_max_ms: 600000, samples });
const journal = rows.map(r => JSON.stringify(r)).join('\n') + '\n'; parseJournal(journal);
fs.mkdirSync('tests/fixtures', { recursive: true }); fs.writeFileSync('tests/fixtures/SYNTHETIC-tactical-demo.jsonl', journal);
console.log('Synthetic fixture written. Export it with scripts/export-replay.mjs.');
