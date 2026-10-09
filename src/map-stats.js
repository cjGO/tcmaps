export function summarizeRounds(headers, allRows, min, max) {
  const playerIndex = headers.indexOf('player_count');
  const resultIndex = headers.indexOf('result');
  const durationIndex = headers.indexOf('duration_seconds');
  const rows = allRows.filter(row => {
    const players = Number(row[playerIndex]);
    return Number.isInteger(players) && players >= min && players <= max;
  });
  const durations = rows.map(row => row[durationIndex]?.trim())
    .filter(value => value !== undefined && value !== '').map(Number)
    .filter(value => Number.isFinite(value) && value >= 0);
  return {
    rows,
    games: rows.length,
    durationGames: durations.length,
    duration: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    win: rows.length ? rows.filter(row => row[resultIndex] === 'team1').length / rows.length * 100 : null,
  };
}

export function orderMaps(images, statsByFilename, metric, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  return [...images].sort((a, b) => {
    const byNumber = a.filename.localeCompare(b.filename, undefined, { numeric: true });
    if (metric === 'number') return sign * byNumber;
    const left = statsByFilename.get(a.filename)?.[metric] ?? null;
    const right = statsByFilename.get(b.filename)?.[metric] ?? null;
    // Unavailable averages always go last; zero games is a valid count.
    if (left === null || right === null) return left === right ? byNumber : left === null ? 1 : -1;
    return sign * (left - right) || byNumber;
  });
}
