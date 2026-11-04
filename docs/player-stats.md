# Player statistics dashboard

Open **PLAYER STATS**, or link directly to `/?tab=playerstats`.

The dashboard includes a searchable leaderboard, personal and squad efficiency
plots, top-eight rankings, player profiles, comparisons, human/bot kill splits,
95% Wilson win-rate intervals, UTC activity charts, and CSV export. Date filters
and minimum completed rounds apply before cohort statistics are calculated.
Player lookup follows the date period but is independent of cohort qualification.
The initial minimum is 20 completed rounds; lower it to inspect small samples.

## Updating the data

Keep the original server export in `stats/`, including `events/index.jsonl` and
its referenced journals. Local development and builds use this export when it is
present. To refresh the small, portable dataset used by Git-based deployments:

```sh
npm run prepare:player-stats
```

Include `lib/player-stats.json` with the source changes. Raw journals remain
ignored by Git; they are never copied into browser assets. The aggregate contains
display names, past aliases, daily counters, and opaque player keys. It does not
contain raw account IDs. Data is loaded only when the tab is opened and is a
static export, not a live server feed.

The importer follows the journal index rather than scanning all day files. It
requires a contiguous sequence, reconciles cumulative counters at the snapshot
cursor, and applies any subsequent events once. Daily charts use event UTC
timestamps because buffered writes can cross a journal-file date boundary.
Unindexed files are excluded. If journal validation fails, a valid snapshot can
still provide lifetime statistics, with date filters and history disabled and a
visible explanation. The previous snapshot is tried if the current one is invalid.
If no raw sources exist, the committed aggregate is used instead.

Kills include bots; personal and squad counters remain separate. Win rate includes
draws in its denominator. Zero denominators are undefined. Completed player-rounds
are participation counts, not unique server rounds. Combat can be recorded without
an eligible round result, so kills per completed round are aggregate ratios. No
playtime or opponent-adjusted skill rating is inferred. Full definitions are in
the dashboard's expandable methodology notes.

## Verification

```sh
node --test tests/player-stats.test.js
uv run --with playwright python tests/player_stats_smoke.py http://127.0.0.1:4173
```

The browser check expects the real snapshot and a running Vite server. It checks
snapshot-derived totals, date filters, search, sorting, pagination, keyboard chart
selection, player comparison, CSV download, mobile overflow, and tab navigation.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium installation.
