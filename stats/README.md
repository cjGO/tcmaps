# Commander Battle statistics

The dedicated server writes this directory relative to its Lua working directory.
Deploy `statistics.lua`, `statistics_json.lua`, and these empty subdirectories
alongside `main.lua`, plus the rebuilt `scripts.txt`, `mission_templates.txt`,
and `quick_strings.txt`. Keep existing quick-string/global-variable IDs when
building a partial module update. No client installation is required.

- `events/index.jsonl`: ordered journal-day index.
- `events/YYYY-MM-DD.jsonl`: version 1 event records with sequence, timestamp,
  event kind, per-UID counter deltas, and kill attribution or round result.
- `snapshots/current.json`: version 1 cumulative counters and replay cursor.
- `snapshots/previous.json`: preceding valid snapshot, used for recovery.
- `backups/`: reserved for operator backups; copy the **whole stats directory**
  while the server is stopped. No automatic off-server backup is configured.

Never replace or delete this directory during module updates. One server process
must own it. Events are retained indefinitely; monitor disk space. Do not prune
the journals without retaining a complete backup/recovery chain. Data collection
begins on installation. IDs are kept as decimal strings; names are display data.

Counters: personal enemy kills (human/bot split), deaths, personal teamkills,
squad enemy kills (human/bot split), squad teamkills, squad casualties, completed
rounds, wins, losses, and draws. Deaths/casualties include friendly and environmental
causes. Horses do not count as soldiers. A bot taken over by a human subsequently
counts as personal combat. Ownership follows actual group assignments and the
owner's connection generation, preventing slot reuse from inheriting old bots.

No connected time, playing time, spectator duration, or time-based metrics are
collected. Timestamps are event history and write scheduling only. Preparation
and post-round events are excluded. Other game modes do not record combat.
Aborted/skipped rounds have no result. A player must spawn, remain connected on
the same playing team, and never switch teams during the round to earn its result.
Deaths do not disqualify players; disconnect/reconnect within a round does.

`/stats` shows lifetime counters and ratios; `/stats session` shows counters since
the current connection, including across maps. A restart starts a new session.
Lifetime averages are arithmetic means of each eligible player's ratio, requiring
20 completed rounds and a positive denominator. K/D includes bot kills; win rate
is wins divided by all completed rounds (including draws). Undefined ratios are
`N/A`. Ineligible players still see their own statistics.

`/leaderboard [personal|squad|wins] [page]` shows five lifetime totals per page;
the default is squad kills. Only positive totals appear. Ties use numeric UID order.
Replies are private across global, team, and O-key chat. Both commands share a
three-second per-connection cooldown. `/help`, `/info`, and `/guide` advertise them.

Writes flush every five seconds and at round/map boundaries. Snapshots are written
every five minutes and at map boundaries. A crash may lose queued events; closing
a file does not guarantee survival of a power failure. Startup replays journal
events after the snapshot cursor and recovers from the previous snapshot if needed.
An incomplete last append is preserved as `.incomplete` before repairing the tail.
Complete malformed records and sequence gaps stop tracking rather than silently
resetting player data. Storage/runtime failures log `[statistics]`, make commands
report unavailable, and freeze statistics until restart without stopping gameplay.
Correct the underlying problem before restarting; retain damaged files for diagnosis.

Validation: `uv run --with lupa python -B lua/test_statistics.py` from MOD.
The optional isolated Windows engine probe is `lua/probe_statistics_runtime.py`;
it creates a private, unlisted temporary server and never modifies live statistics.
