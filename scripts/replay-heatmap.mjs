// Streaming across files: retain one decoded round and an aggregate grid.
import fs from 'node:fs';
import { parseBundle, movementHeatmap, MAX_BYTES, sourceEqual } from '../src/tactical-replay.js';
const [output, ...files] = process.argv.slice(2);
if (!output || !files.length) throw new Error('Usage: node scripts/replay-heatmap.mjs NEW.json ROUND.replay.json ...');
const cells = new Map(), seen = new Set(); let aggregate;
for (const file of files) {
  if (fs.statSync(file).size > MAX_BYTES + 12 * 1024 * 1024) throw new Error('Bundle too large');
  const { replay, data } = await parseBundle(fs.readFileSync(file, 'utf8'));
  if (seen.has(replay.header.id)) continue;
  if (aggregate && !sourceEqual(aggregate.source, data.source)) throw new Error('Mixed terrain versions: aggregate each exact version separately');
  const result = movementHeatmap([replay], data);
  if (aggregate && aggregate.synthetic !== result.synthetic) throw new Error('Do not combine synthetic demonstrations and real battles');
  aggregate ||= { ...result, recordings: [], cells: [], soldier_seconds: 0 };
  aggregate.recordings.push(replay.header.id); aggregate.soldier_seconds += result.soldier_seconds; seen.add(replay.header.id);
  for (const row of result.cells) {
    const key = `${row.ix},${row.iy},${row.team},${row.kind},${row.mounted}`;
    const existing = cells.get(key) || { ...row, seconds: 0, metres: 0 };
    existing.seconds += row.seconds; existing.metres += row.metres; cells.set(key, existing);
  }
}
aggregate.cells = [...cells.values()]; fs.writeFileSync(output, JSON.stringify(aggregate) + '\n', { flag: 'wx' });
console.log(`${seen.size} unique rounds, ${aggregate.soldier_seconds.toFixed(1)} soldier-seconds. Synthetic input remains synthetic; do not combine it with battle data.`);
