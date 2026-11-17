export const MATCHUP_UNITS = [
  ['infantry', 'Inf'], ['cavalry', 'Cav'], ['artillery', 'Arty'],
  ['light', 'Lights'], ['rifles', 'Rifles'],
];

export const MATCHUP_SIZE = MATCHUP_UNITS.length;
export const MATCHUP_FIELDS = 4;

// Each daily entry stores a row-major cell index followed by personal kills,
// personal losses, squad kills, and squad losses.
export function playerMatchups(rows = [], start = '', end = '', scope = 'all') {
  const cells = Array.from({ length: MATCHUP_SIZE ** 2 }, () => ({ kills: 0, losses: 0 }));
  let kills = 0, losses = 0;
  for (const [day, entries] of rows) {
    if ((start && day < start) || (end && day > end)) continue;
    for (const [index, personalKills, personalLosses, squadKills, squadLosses] of entries) {
      const cellKills = (scope === 'squad' ? 0 : personalKills) + (scope === 'personal' ? 0 : squadKills);
      const cellLosses = (scope === 'squad' ? 0 : personalLosses) + (scope === 'personal' ? 0 : squadLosses);
      cells[index].kills += cellKills;
      cells[index].losses += cellLosses;
      kills += cellKills;
      losses += cellLosses;
    }
  }
  return { cells, kills, losses };
}
