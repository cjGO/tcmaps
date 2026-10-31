import test from 'node:test';
import assert from 'node:assert/strict';
import { videoSchedule, videoStatsHistory, videoStatsAt, videoReplayModel } from '../src/replay-video-model.js';
import { parseExperimentalJournal } from '../src/experimental-replay.js';
import { experimentalStrengthAt } from '../src/experimental-replay-presentation.js';
import { experimentalFixture, journal, finalize } from './fixtures/experimental-fixtures.js';

const track = (id, birth, death, changes, removalReason = 'death') => ({ id, birth, death, changes, removalReason, samples: [] });
const meta = (t, team, kind = 'bot') => ({ t, team, kind });
const replay = { header: { round_start_ms: 10000 }, first: 12000, coverageEnd: 30000, tracks: new Map([
  [1, track(1, 11000, 15000, [meta(11000, 0)])],
  [2, track(2, 12000, 20000, [meta(12000, 1), meta(14000, 1, 'player')])],
  [3, track(3, 16000, 25000, [meta(16000, 0), meta(19000, 1)], 'despawn_observed')],
  [4, track(4, 17000, 21000, [meta(17000, -1)])],
  [5, track(5, 22000, 28000, [meta(22000, 1)])],
  [6, track(6, 29000, 29000, [meta(29000, 2)])],
  [7, track(7, 29000, 31000, [meta(29000, 0)])],
]) };

test('video stats count real bot deaths without positions, independently of bot control and despawns', () => {
  const history = videoStatsHistory(replay);
  const team = (t, id) => videoStatsAt(history, t).find(row => row.team === id);
  assert.deepEqual(team(12000, 0), { team: 0, alive: 1, deaths: 0, share: .5 });
  assert.equal(team(14000, 0).share, 1); // takeover, not a casualty
  assert.equal(team(14999, 0).deaths, 0);
  assert.deepEqual(team(15000, 0), { team: 0, alive: 0, deaths: 1, share: null });
  assert.equal(team(17000, 0).share, 1); // unassigned excluded from denominator
  assert.equal(team(17000, -1).share, null);
  assert.equal(team(19000, 1).alive, 1); // team change applies immediately
  assert.equal(team(20000, 1).deaths, 0); // player-controlled death excluded
  assert.equal(team(21000, -1).deaths, 1);
  assert.equal(team(25000, 1).deaths, 0); // despawn excluded
  assert.equal(team(28000, 1).deaths, 1);
  assert.equal(team(29000, 2).deaths, 1); // zero-length observed lifetime
  assert.equal(team(30000, 0).deaths, 1); // future death excluded
  assert.deepEqual(team(12000, 0), { team: 0, alive: 1, deaths: 0, share: .5 }); // reverse seek
});

test('frame timestamps and simulation time are deterministic, speed-scaled, and include clip endpoint', () => {
  const schedule = videoSchedule(replay, { start: 2, end: 12, speed: 5 });
  assert.equal(schedule.duration, 2); assert.equal(schedule.frames, 60);
  assert.deepEqual(schedule.frame(0), { timestamp: 0, duration: 1 / 30, t: 12000 });
  assert.equal(schedule.frame(30).t, 17000);
  assert.equal(schedule.frame(59).t, 22000);
  assert.ok(Math.abs(schedule.frame(59).timestamp + schedule.frame(59).duration - 2) < 1e-9);
  const fractional = videoSchedule(replay, { start: 2, end: 2.51, speed: 1 });
  assert.equal(fractional.frames, 16);
  assert.ok(Math.abs(fractional.frame(15).duration - .01) < 1e-9);
  assert.equal(fractional.frame(15).t, 12510);
  assert.equal(videoSchedule(replay, { start: 2, end: 2.001, speed: 60 }).frames, 1);
});

test('invalid or out-of-coverage clip times and speed are rejected', () => {
  for (const options of [
    { start: 1, end: 12, speed: 1 }, { start: 2, end: 21, speed: 1 },
    { start: 3, end: 2, speed: 1 }, { start: 2, end: 2, speed: 1 },
    { start: NaN, end: 12, speed: 1 }, { start: 2, end: 12, speed: 0 },
    { start: 2, end: 12, speed: Infinity },
  ]) assert.throws(() => videoSchedule(replay, options));
});

test('experimental export uses capture elapsed time without changing the source model', () => {
  const rows = experimentalFixture(); rows[0].round_start_seconds = 42;
  const recording = parseExperimentalJournal(journal(rows));
  const model = videoReplayModel(recording);
  assert.equal(model.header.round_start_ms, 1000);
  assert.equal(model.coverageEnd, recording.last);
  assert.equal(videoReplayModel(model), model);
  assert.equal(recording.header.round_start_ms, undefined);
  assert.equal(typeof recording.tracks.get(1).birth, 'object');
  const clip = videoSchedule(recording, { start: 0, end: 10, speed: 5 });
  assert.equal(clip.frames, 60);
  assert.equal(clip.frame(0).t, recording.first);
  assert.equal(clip.frame(59).t, recording.last);
  assert.throws(() => videoSchedule(recording, { start: 0, end: 10.001, speed: 1 }));
});

test('experimental export stats match live lifetimes, deaths, removals and reverse seeks', () => {
  const rows = experimentalFixture();
  rows.find(row => row.type === 'death').position = false;
  const recording = parseExperimentalJournal(journal(rows)), history = videoStatsHistory(recording);
  for (const t of [1000, 6999, 7000, 11000, 3000]) {
    const live = experimentalStrengthAt(recording, t);
    for (const row of videoStatsAt(history, t)) assert.equal(row.alive, live.get(row.team) || 0);
  }
  assert.equal(videoStatsAt(history, 6999).find(row => row.team === 1).deaths, 0);
  assert.equal(videoStatsAt(history, 7000).find(row => row.team === 1).deaths, 1);
  // A removal remains excluded even if its reason text says death.
  const removed = experimentalFixture();
  removed.find(row => row.type === 'death').type = 'remove';
  const removalHistory = videoStatsHistory(parseExperimentalJournal(journal(finalize(removed))));
  assert.equal(videoStatsAt(removalHistory, 7000).find(row => row.team === 1).deaths, 0);
});
