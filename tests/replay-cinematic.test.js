import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createCinematicCamera, cinematicSettings } from '../src/replay-cinematic-camera.js';
import { parseExperimentalJournal, neutralReference } from '../src/experimental-replay.js';
import { experimentalFixture, journal } from './fixtures/experimental-fixtures.js';
import { groundHeight } from '../src/editor-spatial.js';

const terrain = { bounds: { x_min_m: 0, x_max_m: 400, y_min_m: 0, y_max_m: 400 },
  xs: [0, 200, 400], ys: [0, 200, 400], grid_size: 3,
  min_height_m: 0, max_height_m: 0, heights_mm: Array(9).fill(0) };
function recording() {
  const tracks = new Map();
  for (let id = 0; id < 22; id++) tracks.set(id, { id, birth: 0, death: Infinity,
    changes: [{ t: 0, kind: 'bot', team: id % 2 }],
    samples: [0, 10000, 20000].map((t, index) => ({ t, index, x: id < 20 ? 70 + id % 2 * 10 + t / 200 : 380,
      y: id < 20 ? 80 + id : 380, z: 0, facing: 0 })) });
  return { header: { sample_interval_ms: 10000 }, tracks, first: 0, coverageEnd: 20000, maxGap: 10000 };
}

test('cinematic follows the moving battle and is identical after reverse seeks and across independent renderers', () => {
  const replay = recording(), camera = createCinematicCamera(replay, terrain), second = createCinematicCamera(replay, terrain);
  const options = { speed: 10, aspect: 1.6, settings: { context: 0 } };
  const a = camera.at(5000, options), b = camera.at(15000, options);
  assert.ok(b.target[0] > a.target[0] + 30);
  assert.ok(a.target[0] < 150 && a.target[1] < 150, 'Outlying units must not dominate the engagement');
  assert.deepEqual(camera.at(5000, options), a);
  assert.deepEqual(second.at(5000, options), a);
  for (const t of [0, 5999, 6000, 6001, 20000]) {
    const pose = camera.at(t, options);
    assert.ok([...pose.position, ...pose.target].every(Number.isFinite));
    assert.ok(Math.hypot(...pose.position.map((v, i) => v - camera.at(t + .01, options).position[i])) < 1);
  }
});

test('orbit controls support stationary angle, reverse orbit and speed-scaled playback', () => {
  const camera = createCinematicCamera({ ...recording(), tracks: new Map() }, terrain);
  const angle = pose => Math.atan2(pose.position[1] - pose.target[1], pose.position[0] - pose.target[0]);
  assert.equal(angle(camera.at(0, { settings: { orbit: 0 } })), angle(camera.at(15000, { settings: { orbit: 0 } })));
  assert.ok(angle(camera.at(15000, { settings: { orbit: -2 } })) < angle(camera.at(0)));
  assert.ok(Math.abs(angle(camera.at(10000, { speed: 2 })) - angle(camera.at(5000, { speed: 1 }))) < 1e-12);
});

test('empty and missing-position recordings fall back to full terrain framing at narrow and wide aspects', () => {
  const replay = recording(); replay.tracks.clear();
  const camera = createCinematicCamera(replay, terrain);
  for (const aspect of [.5, 1.6, 3]) {
    const pose = camera.at(3000, { aspect }), projection = new PerspectiveCamera(pose.fov, aspect, .2, 10000);
    projection.up.set(0, 0, 1); projection.position.fromArray(pose.position); projection.lookAt(new Vector3().fromArray(pose.target)); projection.updateMatrixWorld();
    for (const x of [0, 400]) for (const y of [0, 400]) {
      const p = new Vector3(x, y, 0).project(projection);
      assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1);
    }
  }
});

test('terrain sightline remains above ridges at exaggerated height', () => {
  const hills = { ...terrain, max_height_m: 150, heights_mm: [0, 0, 0, 150000, 0, 150000, 0, 0, 0] };
  const camera = createCinematicCamera(recording(), hills);
  for (const t of [0, 5000, 15000]) {
    const pose = camera.at(t, { scale: 4, settings: { elevation: 25, context: 0 } });
    for (let i = 1; i <= 16; i++) {
      const f = i / 16, p = pose.target.map((v, axis) => v + (pose.position[axis] - v) * f);
      assert.ok(p[2] >= groundHeight(hills, p[0], p[1]) * 4 + 3 - 1e-6);
    }
  }
});

test('v2 native lifetimes and missing samples yield finite deterministic camera poses', () => {
  const replay = parseExperimentalJournal(journal(experimentalFixture()));
  const camera = createCinematicCamera(replay, neutralReference(replay));
  for (const t of [replay.first, 7000, replay.last, 3000]) {
    const pose = camera.at(t);
    assert.ok([...pose.position, ...pose.target].every(Number.isFinite));
    assert.deepEqual(camera.at(t), pose);
  }
});

test('settings sanitize non-finite values and enforce supported ranges', () => {
  assert.deepEqual(cinematicSettings({ orbit: NaN, elevation: -10, context: 900, smoothing: Infinity }),
    { orbit: 2, elevation: 25, context: 100, smoothing: 6 });
});
