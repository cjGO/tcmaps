// Artificial command/event sequences, never represented as engine captures.
export function experimentalFixture({ soldiers = 2, burst = 1 } = {}) {
  const rows = [], p = (x = 0, y = 0, z = 100, rz = 0) => [x, y, z, 0, 0, rz];
  const add = (type, t, fields = {}) => { const row = { type, t, seq: rows.length + 1, ...fields }; rows.push(row); return row; };
  add('header', 1000, { schema: 'warband-experimental-replay', version: 1, id: 'SYNTHETIC-experimental-artillery', created_utc: '2026-10-29T00:00:00Z', clock: 'mission_timer_a_msec', clock_resolution_ms: 1, start_ms: 1000, round_start_seconds: 0, partial_round: true, sample_interval_ms: 5000, position_units: 'centimetres', rotation_units: 'native_euler_degrees', capture_mode: 'battle', complete: false, synthetic: true,
    map: { available: false, scene: 139, map_id: false, map_name: false, variant_id: false, variant_revision: false, variant_filename: false, version: false, source: false }, build: { synthetic: true, description: 'Artificial viewer fixture, no native-engine provenance' }, fog: { distance_m: -1, colour_rgb: 0xffffff }, capabilities: { shots: 'instrumented', hits: 'incoming_and_script_overrides', artillery: 'scripted', native_missiles: 'unverified_disabled', native_impacts: 'unverified_disabled', exact_native_shot_hit_link: false } });
  for (let i = 1; i <= soldiers; i++) add('entity', 1000, { id: i, engine_agent: i, kind: i === 2 ? 'player' : 'bot', team: i % 2, troop: 100 + i, position: p(i % 30 * 300, Math.floor(i / 30) * 300) });
  const horse = soldiers + 1;
  add('entity', 1000, { id: horse, engine_agent: horse, kind: 'horse', team: 1, troop: 900, position: p(300) });
  const sample = (t, shift) => add('sample', t, { p: [...Array(soldiers)].map((_, i) => [i + 1, p((i + 1) % 30 * 300 + shift, Math.floor((i + 1) / 30) * 300, 100, shift ? 90 : 0), i === 0 ? horse : -1]).concat([[horse, p(300 + shift), -1]]) });
  sample(1000, 0);
  const fire = add('artillery_fire', 2000, { cannon: 10, shooter: 1, ammo: 5, position: p(300, 0, 200) });
  for (let i = 1; i <= burst; i++) { add('projectile_launch', 2000, { id: i, instance: 50 + i, shooter: 1, ammo: 5, parent: fire.seq, position: p(300, 0, 200), movement_parameters: [100, 200, 300] }); add('projectile_segment', 2000, { projectile: i, instance: 50 + i, target: p(2300, i * 40, 1500), duration_centiseconds: 400 }); }
  for (let i = 0; i < burst; i++) add('shot', 3000, { shooter: 1, weapon: 12, position: p(700 + i, 40, 250, 90), direction: 'weapon_transform_not_verified_projectile_direction' });
  const hit = add('hit', 3000, { victim: 2, attacker: 1, weapon: 12, ammo: 8, position: p(900, 20, 200), reported_damage: 75, damage_semantics: 'incoming_trigger_value', projectile: false, projectile_shooter: false });
  add('damage_override', 3000, { hit: hit.seq, value: 20, damage_semantics: 'script_override_not_verified_health_loss' });
  add('projectile_segment', 3500, { projectile: 1, instance: 51, target: p(1500, 1000, 400), duration_centiseconds: 200 });
  add('ground_contact', 4000, { projectile: 1, position: p(1000, 400, 0), movement_parameters: [1, 2] });
  add('bounce_result', 4000, { projectile: 1, position: p(1000, 400, 20), movement_parameters: [2, 1], stop: false });
  add('projectile_segment', 4000, { projectile: 1, instance: 51, target: p(1500, 900, 300), duration_centiseconds: 200 });
  add('water_contact', 4100, { projectile: false, position: p(800, 500, 0) });
  add('prop_contact', 4200, { projectile: 1, prop: 88, position: p(1200, 500, 80) });
  add('agent_contact', 4300, { projectile: 1, victim: 2, position: p(1300, 500, 150) });
  const explosion = add('explosion', 4500, { projectile: 1, shooter: 1, position: p(1400, 600, 100), max_damage: 200, radius_cm: 1000 });
  for (let i = 0; i < burst; i++) add('fragment_launch', 4500, { projectile: 1, shooter: 1, parent: explosion.seq, position: p(1400 + i, 600, 100, i * 17 % 360), speed: 200, launcher: 20, ammo: 30 });
  add('fragment_launch', 4500, { projectile: false, shooter: 1, parent: fire.seq, position: p(300, 0, 200, 30), speed: 200, launcher: 20, ammo: 30 });
  add('projectile_end', 4500, { projectile: 1, reason: 5 });
  sample(6000, 1000);
  add('shot', 7000, { shooter: 1, weapon: 12, position: p(1300, 0, 250, 90), direction: 'weapon_transform_not_verified_projectile_direction' });
  add('death', 7000, { id: 1, killer: 2, reason: 'death', position: p(1500) });
  add('entity', 7000, { id: horse + 1, engine_agent: 1, kind: 'bot', team: 0, troop: 123, position: p(2500) });
  add('hit', 7500, { victim: 2, attacker: horse + 1, projectile_shooter: 1, projectile: 1, weapon: 12, ammo: 8, position: p(1600), reported_damage: 50, damage_semantics: 'incoming_trigger_value' });
  add('projectile_launch', 8000, { id: burst + 1, instance: 51, shooter: 1, ammo: 7, parent: fire.seq, position: p(300, 0, 200), movement_parameters: [1, 2, 3] });
  add('projectile_segment', 8000, { projectile: burst + 1, instance: 51, target: p(1000, 1000, 2000), duration_centiseconds: 0 });
  add('projectile_end', 9000, { projectile: burst + 1, reason: 2 });
  const counts = {}, positions = rows.filter(r => r.type === 'sample').reduce((n, r) => n + r.p.length, 0);
  for (const r of rows) counts[r.type] = (counts[r.type] || 0) + 1;
  add('end', 11000, { complete: true, reason: 'manual_stop', coverage_complete: false, dropped_events: 0, positions, counts });
  return rows;
}
export const journal = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
export function finalize(rows) {
  rows = rows.filter(r => r.type !== 'end').map((r, i) => ({ ...r, seq: i + 1 }));
  const counts = {}; for (const r of rows) counts[r.type] = (counts[r.type] || 0) + 1;
  return [...rows, { type: 'end', seq: rows.length + 1, t: rows.at(-1).t, complete: true, reason: 'fixture', coverage_complete: false, dropped_events: 0, positions: rows.filter(r => r.type === 'sample').reduce((n, r) => n + r.p.length, 0), counts }];
}
