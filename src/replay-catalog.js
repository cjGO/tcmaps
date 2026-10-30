import { replayLink } from './replay-link.js';

export function recordingLabel(recording) {
  const map = recording.map_id?.replace(/^test_map_/, 'Test map #') || `Map unverified (${recording.map.replace(/^scn_/, '')})`;
  return `v${recording.version ?? 1} · ${map} - Round ${recording.round ? '#' + recording.round : 'unknown'} - ${recording.players} players recorded - ${recording.bots} bots remaining ${recording.round_ended ? 'at round end' : 'at recording end'}${recording.synthetic ? ' · SYNTHETIC' : ''}`;
}

const nameIndexes = new WeakMap();
const normalizeName = name => name.normalize('NFKC').toLowerCase();
function nameIndex(recording) {
  if (!nameIndexes.has(recording)) {
    nameIndexes.set(recording, (recording.roster ?? []).flatMap(player => player.names).map(normalizeName));
  }
  return nameIndexes.get(recording);
}

export function filterRecordings(recordings, minimumPlayers, playerNames = '') {
  const queries = playerNames.split(',').map(name => normalizeName(name.trim())).filter(Boolean);
  return recordings.filter(recording => (recording.players ?? 0) >= minimumPlayers &&
    queries.every(query => nameIndex(recording).some(name => name.includes(query))));
}

export function renderReplayCatalog(container, recordings, openRecording, { minimumPlayers = 0, playerNames = '', selectedId } = {}) {
  const visible = filterRecordings(recordings, minimumPlayers, playerNames);
  container.replaceChildren();
  if (!visible.length) {
    container.textContent = recordings.length
      ? 'No replays match these filters. Lower the minimum or clear the player names to see more.'
      : 'No published replays yet. Open a local recording below.';
    return 0;
  }
  let previousDay, group;
  for (const recording of visible) {
    const date = new Date(recording.created);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (day !== previousDay) {
      group = document.createElement('section');
      group.className = 'replay-day';
      const heading = document.createElement('h3');
      heading.textContent = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      group.append(heading);
      container.append(group);
      previousDay = day;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = recording.id;
    button.setAttribute('aria-pressed', String(recording.id === selectedId));
    button.textContent = `${recordingLabel(recording)} · ${date.toLocaleTimeString()}`;
    button.title = 'Players: unique recorded connections across the replay; spectators excluded, reconnects counted separately. · ' + recording.bots_by_team.map(({ team, count }) => `${team < 0 ? 'Unassigned' : 'Team ' + (team + 1)}: ${count} bots`).join(' · ');
    button.addEventListener('click', () => openRecording(recording));
    const entry = document.createElement('div');
    entry.className = 'replay-entry';
    entry.append(button);
    const permalink = document.createElement('a');
    permalink.className = 'replay-permalink';
    permalink.href = replayLink(container.ownerDocument.baseURI, recording.id);
    permalink.textContent = 'Replay link';
    permalink.setAttribute('aria-label', `Link to ${button.textContent}`);
    entry.append(permalink);
    const roster = document.createElement('details');
    roster.className = 'replay-roster';
    const summary = document.createElement('summary');
    const players = recording.roster ?? [];
    const unnamed = players.filter(player => !player.names.length).length;
    summary.textContent = `Player roster (${players.length})${unnamed ? ` · ${unnamed} without recorded names` : ''}`;
    const names = document.createElement('p');
    names.textContent = players.map(player => player.names.length ? player.names.join(' / ') : `Player #${player.id} (name unavailable)`).join(' · ') || 'No players recorded.';
    roster.append(summary, names);
    entry.append(roster);
    group.append(entry);
  }
  return visible.length;
}
