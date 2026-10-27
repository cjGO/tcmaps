export function recordingLabel(recording) {
  const map = recording.map_id?.replace(/^test_map_/, 'Test map #') || `Map unverified (${recording.map.replace(/^scn_/, '')})`;
  return `${map} - Round ${recording.round ? '#' + recording.round : 'unknown'} - ${recording.players} players recorded - ${recording.bots} bots remaining ${recording.round_ended ? 'at round end' : 'at recording end'}${recording.synthetic ? ' · SYNTHETIC' : ''}`;
}

export function filterRecordings(recordings, minimumPlayers) {
  return recordings.filter(recording => (recording.players ?? 0) >= minimumPlayers);
}

export function renderReplayCatalog(container, recordings, openRecording, { minimumPlayers = 0, selectedId } = {}) {
  const visible = filterRecordings(recordings, minimumPlayers);
  container.replaceChildren();
  if (!visible.length) {
    container.textContent = recordings.length
      ? 'No replays match this player count. Lower the minimum to see more.'
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
    group.append(button);
  }
  return visible.length;
}
