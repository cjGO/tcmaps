export function recordingLabel(recording) {
  const map = recording.map_id?.replace(/^test_map_/, 'Test map #') || `Map unverified (${recording.map.replace(/^scn_/, '')})`;
  return `${map} - Round ${recording.round ? '#' + recording.round : 'unknown'} - ${recording.bots} bots remaining ${recording.round_ended ? 'at round end' : 'at recording end'}${recording.synthetic ? ' · SYNTHETIC' : ''}`;
}

export function renderReplayCatalog(container, recordings, openRecording) {
  let previousDay, group;
  for (const recording of recordings) {
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
    button.setAttribute('aria-pressed', 'false');
    button.textContent = `${recordingLabel(recording)} · ${date.toLocaleTimeString()}`;
    button.title = recording.bots_by_team.map(({ team, count }) => `${team < 0 ? 'Unassigned' : 'Team ' + (team + 1)}: ${count} bots`).join(' · ');
    button.addEventListener('click', () => openRecording(recording));
    group.append(button);
  }
}
