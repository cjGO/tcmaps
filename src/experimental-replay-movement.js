import { createReplayMovement } from './replay-movement-layer.js';
import { eventIndex } from './experimental-replay.js';
import { resolveDisplayMetadata, displayMeta, matchesDisplay, experimentalHistory, experimentalDeaths } from './experimental-replay-presentation.js';

// Preserve experimental lifetimes and the millisecond/sequence cursor while
// using the same movement renderer as the standard replay.
export function createExperimentalMovement(viewer, data, replay, group, picks, { metadata, reference }) {
  metadata = resolveDisplayMetadata(replay, metadata);
  const deaths = experimentalDeaths(replay, metadata);
  let frame;
  const movement = createReplayMovement(viewer, data, {
    capacity: replay.tracks.size,
    poses: () => frame.entities,
    meta: p => displayMeta(replay.tracks.get(p.id), p, metadata),
    matches: matchesDisplay,
    history: state => experimentalHistory(replay, data, metadata, state),
    deaths,
    deathIndex: (rows, state) => eventIndex(rows, state.t, state.seq),
  }, group, picks, { reference, prefix: 'experimental' });
  const options = state => ({ ...state, trails: state.layers?.trails, deaths: state.botDeaths, followSoldier: state.follow });
  return {
    update(nextFrame, state) { frame = nextFrame; return movement.update(options(state)); },
    heatmap: state => movement.heatmap(options(state)),
    dispose: movement.dispose,
  };
}
