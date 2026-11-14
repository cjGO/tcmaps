# Rotation spawn sweep

In Current rotation, enable **Spawn sweep · edit Source / RAW → SPAWNPOINT**
above the 3D view. This loads the registered RAW terrain, regardless of the
variant dropdown. Where several RAW archives exist, choose the intended SCO/recipe
revision in the RAW revision selector; drafts for different revisions remain separate.
A single saved revision is selected automatically when you return. Maps without a
registered RAW archive cannot be edited until their source is imported. Click a team's Place button then click the terrain, or enter
X/Y in metres (three decimal places). Both markers and team cameras use your
draft. Notes and valid coordinate changes save when the field loses focus.
**Mark reviewed & next map** saves the pair and advances using the current
rotation order/filter. Editing a reviewed map returns it to draft.

Progress is stored under `rate-maps.spawn-sweep.v1` in localStorage for this
browser/origin. Export JSON regularly: clearing site data, changing browsers,
or changing the site's address does not carry localStorage over. JSON restores
merge distinct maps/source revisions and reject conflicting records, so a
backup cannot silently replace newer work. Storage failures are shown; valid
in-memory edits remain exportable. Concurrent tab writes are rejected.

## Pipeline handoff contract (version 1)

JSON is the authoritative backup, identified by
`schema: "rate-maps.spawn-sweep"`, `version: 1`. Each `maps` record contains:

- Stable `map_id`; `scene_id` is only the historical rotation slot.
- `source_variant: "source"`, `target_variant: "SPAWNPOINT"`.
- RAW `source.sco_sha256`, `source.recipe_sha256`, terrain code, terrain checksum
  and bounds. Never identify inputs solely by slot or display name.
- Untouched `default_spawn_points`, including original height/facing metadata.
- `spawn_points`: exactly `{team, entry, x_m, y_m}` for team 0 / entry 0 and
  team 1 / entry 32. These are scene-world XY metres, not pixels. Z is omitted
  intentionally: resolve it against the source terrain during compilation.
- `status` (`draft` or `reviewed`), optional notes and save timestamp.

CSV contains two rows per saved map/source, with status, source hashes, new XY
and original XY. It is useful for inspection or tabular pipeline ingestion;
it is not a full restorable backup. Both exports include unfinished drafts and
older source revisions so no collected records are silently discarded.

The pythonhelper consumer must select **reviewed** records, match the exact RAW
SCO and recipe hashes, check original spawns against that input, and validate
bounds/team entries before applying the pair. Resolve terrain heights using the
pipeline's normal ground probe and preserve the pipeline's facing convention.
Save a separate `<map_id>_SPAWNPOINT` scene and recipe plus the input provenance;
keep RAW immutable. Future noise asset generation should use this compiled
SPAWNPOINT version as its input, retaining the parent identity and hashes.

This sweep export is a batch handoff schema, **not** a version-3 placement
loadout. A placement-based consumer should first prepare the matching RAW
project, then copy `spawn_points` into its version-3 loadout using that project's
exact `default_spawn_points`. Do not pass the entire sweep JSON as a loadout.
The app collects edits; it does not build or install scenes or change the
pythonhelper pool configuration automatically.
