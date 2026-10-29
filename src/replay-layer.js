import * as THREE from 'three';
import { soldierAt, upperIndex, unitCategory, playerLabel } from './tactical-replay.js';
import { createMovementHistory, matchesHistory, botDeathMarkers } from './replay-history.js';
import { createReplayMovement } from './replay-movement-layer.js';

export function createReplayLayer(viewer, data, replay) {
  const group = new THREE.Group(), picks = new Map(), deaths = botDeathMarkers(replay).map(p => ({ ...p, unit_category: unitCategory(p) }));
  const movement = createReplayMovement(viewer, data, {
    capacity: replay.tracks.size,
    poses: state => [...replay.tracks.values()].map(track => soldierAt(track, state.t, replay)).filter(Boolean),
    meta: p => ({ ...p, unit_category: unitCategory(p), label: playerLabel(p) }),
    matches: (p, state) => matchesHistory(p, p.id, state),
    history: state => createMovementHistory(replay, data, state),
    deaths,
    deathIndex: (rows, state) => upperIndex(rows, state.t),
  }, group, picks);
  // Preserve the standard layer's public API and diagnostic mesh names.
  group.getObjectByName('replay-bot-deaths').name = 'bot-deaths';
  group.getObjectByName('replay-artillery-units').name = 'replay-artillery';
  const state = { t: replay.first, players: true, bots: true, playerNames: false, heatmap: false, trails: false, trailOpacity: .25, deaths: true, deathOpacity: .25, squad: '', soldier: '' };
  viewer.addLayer(group);
  function update(next = {}) {
    Object.assign(state, next);
    const stats = movement.update(state); viewer.draw(false); return stats.visible;
  }
  const unsubscribe = viewer.onHeightChange(() => update());
  return { update, dispose() { unsubscribe(); movement.dispose(); group.removeFromParent(); } };
}
