const DAY = 86400000;

// Login and logout callbacks append separate rows for the same session.
// Missing logouts establish presence only on the recorded login day.
function playerDays(headers, rows) {
  const column = name => headers.indexOf(name);
  const sessions = new Map();
  for (const row of rows) {
    const id = row[column('player_id')]?.trim();
    const login = Date.parse(row[column('login_utc')]);
    const logout = Date.parse(row[column('logout_utc')]);
    if (!id || !/^\d+$/.test(id) || /^0*([01])$/.test(id) || !Number.isFinite(login)) continue;
    const key = id + ':' + login;
    const end = Number.isFinite(logout) && logout >= login ? logout : login;
    const previous = sessions.get(key);
    sessions.set(key, { id, login, end: Math.max(previous?.end ?? login, end) });
  }
  const days = new Map();
  for (const { id, login, end } of sessions.values()) {
    const first = Math.floor(login / DAY);
    const last = Math.floor((end > login ? end - 1 : login) / DAY);
    for (let day = first; day <= last; day++) {
      if (!days.has(day)) days.set(day, new Set());
      days.get(day).add(id);
    }
  }
  return days;
}

export function dailyUniquePlayers(headers, rows) {
  return [...playerDays(headers, rows)].sort(([a], [b]) => a - b).map(([day, players]) => ({
    day: new Date(day * DAY).toISOString().slice(0, 10), players: players.size,
  }));
}

export function weeklyUniquePlayers(headers, rows) {
  const days = playerDays(headers, rows);
  return [...days.keys()].sort((a, b) => a - b).map(day => {
    const players = new Set();
    for (let offset = 0; offset < 7; offset++) {
      for (const id of days.get(day - offset) ?? []) players.add(id);
    }
    return { day: new Date(day * DAY).toISOString().slice(0, 10),
      start: new Date((day - 6) * DAY).toISOString().slice(0, 10), players: players.size };
  });
}
