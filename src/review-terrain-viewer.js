import {createTopologyViewer} from './topology-viewer.js';
import {reviewTerrainData} from './review-terrain-data.js';

export function createReviewTerrain(container, grid, candidate, spawns, scale, onError) {
  const viewer=createTopologyViewer(container,reviewTerrainData(grid,candidate,spawns,scale),onError,{explorer:false});
  viewer.canvas.setAttribute('aria-label',`${candidate.name} 3D terrain. Drag to orbit, scroll to zoom, right-drag to pan.`);
  viewer.recordedFog(null);
  return viewer;
}
