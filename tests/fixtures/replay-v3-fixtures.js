// Deliberately synthetic: both endpoints and timings are authored, not measured.
export function v3Fixture() {
  const rows = [], p = (x, y, z = 100, heading = 0) => [x, y, z, 0, 0, heading];
  const add = (type, t, fields = {}) => rows.push({ type, t, ...fields });
  add('header', 1000, { schema: 'warband-experimental-replay', version: 2, id: 'SYNTHETIC-replay-v3', created_utc: '2026-11-07T00:00:00Z',
    clock: 'mission_timer_a_msec', clock_resolution_ms: 1, start_ms: 1000, round_start_seconds: 0, partial_round: true,
    sample_interval_ms: 5000, position_units: 'centimetres', rotation_units: 'native_euler_degrees', capture_mode: 'battle', complete: false, synthetic: true,
    map: { available: false, scene: 139, map_id: false, map_name: false, variant_id: false, variant_revision: false, variant_filename: false, version: false, source: false },
    build: { id: 'synthetic-v3', synthetic: true }, fog: { distance_m: -1, colour_rgb: 0xffffff },
    capabilities: { shots: 'instrumented', hits: 'incoming_and_script_overrides', artillery: 'scripted', native_missiles: 'unverified_disabled', native_impacts: 'unverified_disabled', exact_native_shot_hit_link: false } });
  add('player', 1000, { id: 1, name: 'Synthetic North' }); add('player', 1000, { id: 2, name: 'Synthetic South' });
  for (let id = 1; id <= 24; id++) {
    const team = id <= 12 ? 0 : 1, x = 9000 + ((id - 1) % 12) * 550, y = team === 0 ? 8000 : 20000;
    add('entity', 1000, { id, engine_agent: id, kind: id === 1 || id === 13 ? 'player' : 'bot', team, troop: 100 + id, class: 1, unit_category: 'infantry',
      owner: team + 1, controller: id === 1 || id === 13 ? team + 1 : false, player_name: id === 1 ? 'Synthetic North' : id === 13 ? 'Synthetic South' : false,
      position: p(x, y, 100, team ? 180 : 0) });
  }
  const entities = rows.filter(r => r.type === 'entity');
  for (const t of [1000, 6000, 11000]) add('sample', t, { p: entities.map(r => [r.id, r.position, -1]) });
  for (let i = 0; i < 12; i++) {
    const shot = 3000 + i * 35, x = 9000 + i * 550;
    add('shot', shot, { shooter: i + 1, weapon: 42, position: p(x, 8000, 230), direction: 'weapon_transform_not_verified_projectile_direction' });
    if (i < 9) add('hit', shot + 500, { attacker: i + 1, victim: i + 13, weapon: 42, ammo: 117, projectile: false, projectile_shooter: false,
      position: p(x, 20000, 180), reported_damage: 45, damage_semantics: 'incoming_trigger_value' });
    add('shot', shot + 2600, { shooter: i + 13, weapon: 38, position: p(x, 20000, 230, 180), direction: 'weapon_transform_not_verified_projectile_direction' });
    if (i < 7) add('hit', shot + 3100, { attacker: i + 13, victim: i + 1, weapon: 38, ammo: 117, projectile: false, projectile_shooter: false,
      position: p(x, 8000, 180), reported_damage: 30, damage_semantics: 'incoming_trigger_value' });
  }
  const fire = { cannon: 20, shooter: 1, ammo: 2, position: p(7000, 7000, 180) };
  add('artillery_fire', 7000, fire);
  add('projectile_launch', 7000, { id: 1, instance: 55, shooter: 1, ammo: 2, parent: false, position: fire.position, movement_parameters: [1, 2, 3] });
  add('projectile_segment', 7000, { projectile: 1, instance: 55, target: p(7000, 21000, 100), duration_centiseconds: 120 });
  add('explosion', 8200, { projectile: 1, shooter: 1, position: p(7000, 21000), max_damage: 200, radius_cm: 1000 });
  add('projectile_end', 8200, { projectile: 1, reason: 1 });
  return finalizeV3(rows);
}
export function finalizeV3(rows) {
  rows = rows.filter(r => r.type !== 'end').map(r => ({ ...r })).sort((a, b) => a.t - b.t);
  const counts = {}; let positions = 0;
  rows.forEach((r, i) => { r.seq = i + 1; counts[r.type] = (counts[r.type] || 0) + 1; if (r.type === 'sample') positions += r.p.length; });
  rows.push({ type: 'end', t: Math.max(12000, rows.at(-1).t), seq: rows.length + 1, reason: 'synthetic_fixture', complete: true, counts, positions, dropped_events: 0, coverage_complete: false });
  return rows;
}
export const journalV3 = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
