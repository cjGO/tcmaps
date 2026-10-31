import { botStrengthHistory, botStrengthAt } from './replay-strength.js';
import { upperIndex } from './tactical-replay.js';
import { metadataAt } from './experimental-replay.js';

export const isExperimentalVideo = replay => replay.header.schema === 'warband-experimental-replay';

// Adapt timing and lifetimes only; rendering still consumes the original v2 journal.
export function videoReplayModel(replay) {
  if (!isExperimentalVideo(replay) || Number.isFinite(replay.coverageEnd)) return replay;
  const tracks = new Map([...replay.tracks].map(([id, track]) => [id, { ...track, birth: track.birth.t, death: track.end.t }]));
  return { ...replay, tracks, coverageEnd: replay.last, header: { ...replay.header, round_start_ms: replay.header.start_ms } };
}

export const VIDEO_FPS = 30;
export const videoSize = resolution => resolution === '720' ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };

// The media clock is independent of rendering/encoding wall time.
export function videoSchedule(replay, { start, end, speed }) {
  replay = videoReplayModel(replay);
  if (![start, end, speed].every(Number.isFinite) || speed <= 0) throw new Error('Enter valid times and a positive playback speed.');
  const from = replay.header.round_start_ms + start * 1000, to = replay.header.round_start_ms + end * 1000;
  if (from < replay.first || to > replay.coverageEnd || to <= from) throw new Error('Choose an end later than the start, within recorded coverage.');
  const duration = (to - from) / (1000 * speed), frames = Math.max(1, Math.ceil(duration * VIDEO_FPS));
  return { from, to, duration, frames, frame(index) {
    const timestamp = index / VIDEO_FPS;
    return { timestamp, duration: Math.min(1 / VIDEO_FPS, duration - timestamp),
      // Include the endpoint so the final casualty/state is visible, even at high speed.
      t: index === frames - 1 ? to : Math.min(to, from + timestamp * 1000 * speed) };
  } };
}

export function videoStatsHistory(replay) {
  const alive = botStrengthHistory(videoReplayModel(replay)), teams = new Set(alive.teams), events = [];
  for (const track of replay.tracks.values()) {
    const experimental = isExperimentalVideo(replay);
    const death = experimental ? track.end.t : track.death;
    if ((experimental ? track.end.type !== 'death' : track.removalReason !== 'death') || death > (experimental ? replay.last : replay.coverageEnd)) continue;
    const meta = experimental ? metadataAt(track, death, track.end.seq) : track.changes[upperIndex(track.changes, death)];
    if (meta?.kind !== 'bot') continue;
    teams.add(meta.team); events.push({ t: death, team: meta.team });
  }
  const order = [...teams].sort((a, b) => a - b), counts = new Map(order.map(team => [team, 0]));
  const deaths = events.sort((a, b) => a.t - b.t).map(event => {
    counts.set(event.team, counts.get(event.team) + 1);
    return { t: event.t, counts: new Map(counts) };
  });
  return { alive, teams: order, deaths };
}

export function videoStatsAt(history, t) {
  const alive = botStrengthAt(history.alive, t), deaths = history.deaths[upperIndex(history.deaths, t)]?.counts;
  const total = history.alive.teams.reduce((sum, team, i) => sum + (team >= 0 ? alive[i] : 0), 0);
  return history.teams.map(team => ({ team, alive: alive[history.alive.teams.indexOf(team)] ?? 0,
    deaths: deaths?.get(team) ?? 0,
    share: team < 0 || total === 0 ? null : (alive[history.alive.teams.indexOf(team)] ?? 0) / total }));
}

export const videoClock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export const videoTeamLabel = team => team < 0 ? 'Unassigned' : `Team ${team + 1}`;
export const videoTeamColor = team => team === 0 ? '#62a7ff' : team === 1 ? '#ff786f' : '#edc66c';
