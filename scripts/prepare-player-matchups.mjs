import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { metadataAt, parseExperimentalJournal } from '../src/experimental-replay.js';
import { densityUnit } from '../src/rotation-density.js';
import { MATCHUP_FIELDS, MATCHUP_SIZE, MATCHUP_UNITS } from '../src/player-matchups.js';
import { loadPlayerStats } from './player-stats.mjs';

const unitIndex = new Map(MATCHUP_UNITS.map(([id], index) => [id, index]));

function profileIndex(players) {
  const names = new Map();
  for (const player of players) {
    for (const name of [player.name, ...player.aliases]) {
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, player.id);
      else if (names.get(key) !== player.id) names.set(key, null);
    }
  }
  return names;
}

export async function collectPlayerMatchups(replays, players) {
  const names = profileIndex(players), byPlayer = new Map(), recordings = new Set(), days = new Set();
  const unit = meta => {
    const role = densityUnit(meta);
    return unitIndex.get(role === 'dragoons' ? 'cavalry' : role);
  };
  function add(replay, meta, day, own, enemy, loss) {
    const actor = meta.kind === 'player' ? meta.controller : meta.owner;
    const name = replay.players.get(actor)?.name;
    const id = name && names.get(name.toLowerCase());
    if (!id) return false;
    if (!byPlayer.has(id)) byPlayer.set(id, new Map());
    const perDay = byPlayer.get(id);
    if (!perDay.has(day)) perDay.set(day, new Map());
    const cells = perDay.get(day);
    const index = own * MATCHUP_SIZE + enemy;
    if (!cells.has(index)) cells.set(index, Array(MATCHUP_FIELDS).fill(0));
    const offset = (meta.kind === 'bot' ? 2 : 0) + loss;
    cells.get(index)[offset]++;
    return true;
  }
  for await (const replay of replays) {
    const { header } = replay;
    if (header.version !== 2 || header.synthetic || header.capture_mode !== 'battle' ||
      replay.incomplete || replay.terminal.dropped_events || recordings.has(header.id)) continue;
    recordings.add(header.id);
    const created = Date.parse(header.created_utc);
    for (const death of replay.effects.deaths) {
      const killer = metadataAt(replay.tracks.get(death.killer), death.t, death.seq);
      const victim = metadataAt(replay.tracks.get(death.id), death.t, death.seq);
      if (!killer || !victim || ![0, 1].includes(killer.team) || ![0, 1].includes(victim.team) ||
        killer.team === victim.team || !['player', 'bot'].includes(killer.kind) || !['player', 'bot'].includes(victim.kind)) continue;
      const attacker = unit(killer), defender = unit(victim);
      if (attacker === undefined || defender === undefined) continue;
      const day = new Date(created + death.t - header.start_ms).toISOString().slice(0, 10);
      const credited = add(replay, killer, day, attacker, defender, 0);
      const lost = add(replay, victim, day, defender, attacker, 1);
      if (credited || lost) days.add(day);
    }
  }
  return {
    recordings: recordings.size,
    days: [...days].sort(),
    players: Object.fromEntries([...byPlayer].sort().map(([id, perDay]) => [id, [...perDay].sort().map(([day, cells]) =>
      [day, [...cells].sort(([a], [b]) => a - b).map(([index, counts]) => [index, ...counts])],
    )])),
  };
}

async function prepare() {
  const directory = new URL('../experimental_replays/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^EXP-[\w-]+\.jsonl$/.test(file)).sort();
  const stats = await loadPlayerStats(fileURLToPath(new URL('../stats/', import.meta.url)));
  const profiles = stats.players.length ? stats.players
    : JSON.parse(await readFile(new URL('../lib/player-stats.json', import.meta.url), 'utf8')).players;
  if (!profiles.length) throw new Error('Player profiles are required to match the names recorded in replays.');
  let skipped = 0;
  async function* readReplays() {
    for (const file of files) {
      const content = await readFile(new URL(file, directory), 'utf8');
      try { yield parseExperimentalJournal(content); }
      catch { skipped++; }
    }
  }
  const data = await collectPlayerMatchups(readReplays(), profiles);
  if (!data.days.length) throw new Error('No classified matchups found. The previous export has been preserved.');
  await writeFile(new URL('../lib/player-matchups.json', import.meta.url), JSON.stringify(data) + '\n');
  console.log(`Prepared matchups for ${Object.keys(data.players).length} players from ${data.recordings} battle recordings. ${skipped} files failed replay validation.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepare();
