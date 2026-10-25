// Engine IDs remain resource keys; only permanent IDs identify feedback.
export function publicMapId(registry, filename) {
  const key = filename?.replace(/\.png$/i, '');
  const row = registry.find(row => row.id === key);
  return row?.map_id || (key?.match(/^test_map_\d+$/) ? key : null);
}
export function mapLabel(registry, filename) {
  const id = publicMapId(registry, filename);
  const row = registry.find(row => row.id === filename?.replace(/\.png$/i, ''));
  return id ? id + (row?.variant_id && row.variant_id !== 'source' ? ` · ${row.variant_id}` : '') : 'Unattributed archived map';
}
export function csvRows(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { value+='"'; i++; } else quoted=!quoted; }
    else if (c === ',' && !quoted) { row.push(value); value=''; }
    else if (c === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push(row); row=[]; value=''; }
    else value+=c;
  }
  if (quoted) throw new Error('Incomplete CSV field');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
