export const SWEEP_STORAGE_KEY = 'rate-maps.spawn-sweep.v2';
export const mapKey = map => `${map.map_id}:${map.projectSha256}`;
export const pointsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const spawnCoordinates = points => points.map(({ team, entry, x_m, y_m }) => ({ team, entry, x_m: Number(x_m.toFixed(3)), y_m: Number(y_m.toFixed(3)) }));
export function validateSweepRecord(record) {
  if (!record || !/^test_map_\d+$/.test(record.map_id) || !/^[a-f0-9]{64}$/.test(record.projectSha256) || typeof record.reviewed !== 'boolean') throw new Error('Invalid saved map identity');
  const b = record.bounds;
  if (!b || !['x_min_m', 'x_max_m', 'y_min_m', 'y_max_m'].every(k => Number.isFinite(b[k])) || b.x_min_m >= b.x_max_m || b.y_min_m >= b.y_max_m) throw new Error('Invalid terrain bounds');
  for (const points of [record.defaults, record.spawns]) {
    if (!Array.isArray(points) || points.length !== 2) throw new Error('Expected two team spawns');
    points.forEach((p, i) => {
      if (p.team !== i || p.entry !== i * 32 || !Number.isFinite(p.x_m) || !Number.isFinite(p.y_m) || p.x_m < b.x_min_m || p.x_m > b.x_max_m || p.y_m < b.y_min_m || p.y_m > b.y_max_m) throw new Error('Invalid spawn coordinates');
    });
    if (points[0].x_m === points[1].x_m && points[0].y_m === points[1].y_m) throw new Error('Team spawns must differ');
  }
  return record;
}
export function parseSweep(raw) {
  const data = JSON.parse(raw);
  if (data.version !== 2 || !Array.isArray(data.maps)) throw new Error('Invalid spawn sweep backup');
  const records = {};
  for (const row of data.maps) {
    validateSweepRecord(row);
    if (records[mapKey(row)]) throw new Error('Duplicate map in backup');
    records[mapKey(row)] = row;
  }
  return records;
}
export const sweepBackup = records => JSON.stringify({ version: 2, maps: Object.values(records) }, null, 2);
export function sweepProgress(maps, records) {
  const edited = maps.filter(map => { const r = records[mapKey(map)]; return r && !pointsEqual(r.spawns, r.defaults); }).length;
  const reviewed = maps.filter(map => records[mapKey(map)]?.reviewed).length;
  return { total: maps.length, edited, unedited: maps.length - edited, reviewed };
}
export function coordinatesCSV(maps, records) {
  const rows = [['map_id', 'team', 'entry', 'x_m', 'y_m']];
  for (const map of maps) {
    const r = records[mapKey(map)];
    if (!r || pointsEqual(r.spawns, r.defaults)) continue;
    for (const p of r.spawns) rows.push([r.map_id, p.team + 1, p.entry, p.x_m, p.y_m]);
  }
  return rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
