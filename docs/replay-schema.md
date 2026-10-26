# Tactical replay schema 1

The server writes UTF-8 JSON Lines (`.jsonl`), one complete record per newline.
Schema identifier: `warband-tactical-replay`, version `1`. Read records in file
order. IDs and strings are data, never executable code or HTML. Optional player
display names may be recorded; account identifiers, IP addresses, equipment
inventories and projectiles are not included.

## Time and coordinates

All `t`, `*_ms` fields are **milliseconds of the mission clock**, not Unix time.
The clock is `mission_timer_a`, read with `store_mission_timer_a`, the same native
integer-second clock as `$g_round_start_time`. `clock_resolution_ms` is **1000**;
encoding in milliseconds does not imply millisecond measurement precision.
Elapsed round time is `t - round_start_ms`. UTC is used only for creation and
filenames. Samples use actual clock readings; delayed ticks do not catch up.

Positions use the engine's native **X/Y horizontal, Z up** axes, converted from
native scalar position getters to integer centimetres. The current native
fixed-point multiplier is read from an identity matrix's X scale and preserved.
Quantization is a storage choice, not a statement of engine accuracy; coordinate
precision also depends on that native multiplier. Facing is stored as integer
millidegrees, clockwise from positive Y, from the negated native Z rotation.
The native rotation getter resolves whole degrees; storage does not add precision.
The recorder reserves otherwise unused `pos24`; existing position registers are
untouched. It restores native numeric registers 0–5 and string register 0. The
stage verifier checks that native module source has not claimed `pos24`.
Horses are not entities. Each soldier sample carries whether `agent_get_horse`
returned a nonnegative horse agent ID.

The website also uses native metres with Z up. Divide XYZ by 100; apply the
existing `displayedHeight(z, terrain.min_height_m, heightScale)` to marker Z.
Marker heading is a negative Z-axis rotation from a local positive-Y arrow.

## Records

`header` is first and unique. Fields:

| Field | Meaning |
|---|---|
| `schema`, `version`, `type` | `warband-tactical-replay`, `1`, `header` |
| `id`, `created_utc` | File-unique recording ID; UTC ISO 8601 creation time |
| `synthetic` | False for server capture; true for artificial browser demonstrations |
| `map` | Exact identity below |
| `round_id` | Process-local mission counter, round counter and native round start; scope with recording ID |
| `round_start_ms`, `round_max_ms` | Native round timing known when capture starts |
| `start_ms`, `start_offset_ms` | Capture starts here; offset is `start_ms - round_start_ms` |
| `sample_interval_ms` | 5000 or 10000 |
| `clock`, `clock_resolution_ms` | `mission_timer_a`, 1000 |
| `position_units`, `facing_units` | `centimetres`, `millidegrees_clockwise_from_positive_y` |
| `complete` | Always false in header; only a valid terminal record finalizes capture |

For a fixed map, `map` contains `id` (scene name for reference), `kind: "fixed"`,
`source: {sco_sha256, recipe_sha256, terrain_code}` and `version`.
`version = SHA256(sco_sha256 + ":" + recipe_sha256)` over ASCII hex strings.
Recipe SHA-256 uses the exact four-line installed scene record, normalized to LF
with a final newline, following `map_editor/core.py:scene_recipe`. The scene slot
is never sufficient for a match. Source hashes preserve identity when an old
recording is opened after a rotation change. The preflight manifest is frozen
when Lua starts, not reloaded while a scene is running.

For a rerolled generator, `map` contains the **loaded**, not next staged,
`current_generated_map_id`, `kind: "generated"`, `available: false` and
`reason: "matching_generated_topology_required"`. That identifier includes the
seeded terrain recipe and template checksum prefix from the existing save-map
workflow. Schema 1's exporter explicitly refuses 3D for these captures. Preserve
the journal and use `/savemap` while that terrain is loaded if later measurement
is wanted. No unrelated fixed terrain is substituted.

`entity` introduces a lifetime:

```json
{"type":"entity","t":20000,"id":1,"origin":"observed","team":0,"kind":"bot","owner":1,"controller":false,"troop":7,"class":0}
```

`id` is recording-local and never reused. Engine agent IDs are not persisted.
`origin` is `spawn` for an observed spawn callback or `observed` for the first
snapshot/control callback that discovers a soldier. `kind` distinguishes bots
from player-controlled soldiers using `agent_is_non_player`; both pass the
engine's `agent_is_human` test. `owner` identifies the current active commander
connection resolved from the agent group; `controller` identifies the player
connection physically controlling the soldier. Both are recording-local integers
or `false` (unknown/no active player). Disconnect/reconnect gets a fresh local
connection identity. `troop` is the module troop ID; `class` is troop slot 10
(`slot_troop_class`). Team 0/1 correspond to displayed Team 1/2.

Optional `player_name` contains the controlling player's display name (1–256
characters), or `false` when unavailable. Optional `unit_category` is `infantry`,
`artillery`, or `cavalry`. Both fields also apply to `change` records. Older
journals remain supported: labels fall back to `Player #<controller>` (or soldier
ID when no controller is known). Categories fall back to troop class: 14–19 are
cavalry and 20–21 are artillery; otherwise mounted soldiers use cavalry markers
and other soldiers use infantry markers. Explicit categories take precedence.

`change` carries the same metadata fields and `id,t`, without `origin`. It updates
the existing lifetime. Native group/control hooks run **after** mutation, so bot
takeover preserves the physical track. Other metadata changes are detected at
the next sample; no finer change time is claimed for them. Repeated unchanged
metadata is not included in snapshots.

A spawn callback never continues an already sampled track, including same-second
agent-ID reuse without a death callback. Duplicate same-second introductions are
deduplicated only while unsampled. A duplicate spawn after sampling conservatively
splits the track rather than risking a false movement connection.

`sample` stores all currently living soldiers in compact rows:

```json
{"type":"sample","t":25000,"p":[[1,12500,24600,1550,359000,1]]}
```

Row order: `[entity_id, x_cm, y_cm, z_cm, facing_millidegrees, mounted_0_or_1]`.
Array order has no identity meaning. Full snapshots simplify recovery, seeking
and aggregation; losing an earlier position row does not break a delta chain.

`remove` closes a lifetime:

```json
{"type":"remove","t":28000,"id":1,"reason":"death","position":"last_sample"}
```

Reasons are `death`, `despawn_observed`, or `agent_id_reused`. The event records
**no newly measured position**; its position is only the last snapshot. A spawn
has no measured position until its first sample. A soldier that dies between
samples before any position was captured is never displayed. The kill hook is
deduplicated; a later respawn uses a new ID even if the engine reuses the slot.

`end` is unique and last:

```json
{"type":"end","t":120000,"complete":true,"reason":"round_end","result":0,"round_start_ms":0,"round_max_ms":300000,"samples":21,"snapshot_cpu_us_total":31000,"snapshot_cpu_us_max":4000}
```

Result is `0`/`1` for the winning team, `-1` for a draw, or `false` if unavailable.
Reasons: `round_end`, `manual_stop`, `map_change`, `mission_reset`, `round_reset`,
`mission_end`, `clock_reset`, `duration_limit`, `entity_limit`, `output_limit`,
`position_limit` (2,000,000 stored soldier positions), `record_limit` (250,000 records),
`agent_scan_limit` (the native roster exceeded four times the lifetime ceiling).
`complete` means a finalized **recording session**, not coverage of the whole
round. `snapshot_cpu_us_*` are historical field names for `os.clock` durations:
CPU time on some Lua hosts, elapsed process-clock time on Windows CRT, with host
resolution limits. They include snapshot encoding and flush; they are not a TPS
or network-latency metric. Command initialization can cost more.

I/O/runtime failures disable the recorder until Lua restart and log the diagnostic.
They normally leave no terminal record; a close failure after a successful terminal
flush can still leave a structurally complete stream. A missing terminal record
is **incomplete**. A reader may discard only an unterminated last line; malformed
complete lines are errors. Flush does not promise physical-disk durability or
atomic writes during power loss. Do not claim crash safety from fixture tests.

## Transfer bundle and validation limits

The website exporter produces one `.replay.json`:

```json
{"schema":"warband-replay-bundle","version":1,"journal":"JSONL text...","terrain_json":"exact topology asset text...","terrain_sha256":"64 lowercase hex characters"}
```

`terrain_sha256` pins the complete versioned terrain asset, including measured
height provenance. Export verifies the archived/current topology manifest hash.
Browser import verifies that hash, source hashes, terrain code, source version,
schema and bounds. It renders the embedded matching terrain in the **existing**
viewer, even when a different map now occupies the slot. A bundle checksum is an
integrity check, not a signature proving who recorded a battle.

Hard reader bounds: 64 MiB journal, 1 MiB record, 250,000 records, 4,096 lifetimes,
2,000,000 position rows, 8 MiB terrain JSON, 501-square maximum measured grid.
The UI permits 20 files and 76 MiB total imported file bytes. Unknown schema
versions, invalid ordering, duplicate lifetimes, out-of-lifetime samples, changed
terrain and malformed input are rejected. These bounds also cap input processing.

Playback interpolates XYZ linearly and facing by the shortest angle. It never
interpolates across a death/lifetime, an omitted soldier snapshot, or a gap above
twice the configured sample interval. There is no visibility before a measured
sample. The final sample may be held for at most one interval, bounded by death
and recording coverage; it is not extrapolated movement. Mounted state and
controller/team metadata switch at their respective recorded timestamps.

## Movement heatmap 1

`warband-movement-heatmap`, version 1, stores `source`, `bounds`, `cell_metres`,
`synthetic`, deduplicated `recordings`, `soldier_seconds`, `method` and `cells`.
Each cell has `ix,iy,team,kind,mounted,seconds,metres`. Coordinates are relative to
the native lower-left bounds. Default cells are 10 metres. `seconds` is occupancy
(soldier-seconds); `metres` is estimated travelled distance, not measured footsteps.

Adjacent valid snapshots contribute their elapsed duration across straight
segments, sampled at half-cell spacing, with recorded ownership/control changes
splitting intervals. Large gaps, final unpaired samples, unrecorded pre-start
time and outside-map positions contribute nothing. This makes 5-second and
10-second captures comparable by exposure, although finer sampling can reveal
curves missing at lower frequency. Deduplicate recording IDs; aggregate exact
source versions separately. Synthetic and real captures must stay separate.
Raw journals remain the source of truth for later rebinning or other analyses.
