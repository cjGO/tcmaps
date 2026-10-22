import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainGeometry, displayedHeight } from '../src/terrain-geometry.js';

const fixture = () => ({ grid_size: 2, xs: [25, 695], ys: [25, 695], heights_mm: [1000, 2000, 3000, 4000], vertical_scale: 1, height_order: 'x-major, y-minor' });
test('world coordinates preserve X/Y and convert millimetres to metres without exaggeration', () => {
  const { positions, indices } = terrainGeometry(fixture());
  assert.deepEqual(Array.from(positions), [25,25,1,25,695,2,695,25,3,695,695,4]);
  assert.deepEqual(Array.from(indices), [0,2,1,2,3,1]);
  // Front faces must point up, not down, after mapping the engine X-major grid.
  const [a,b,c] = Array.from(indices).slice(0,3).map(i => Array.from(positions).slice(i*3,i*3+3));
  assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0);
});
test('corrupt grids and non-finite samples are rejected', () => {
  for (const patch of [{heights_mm:[1]}, {heights_mm:[1,2,NaN,4]}, {xs:[2,1]}, {vertical_scale:4}]) assert.throws(() => terrainGeometry({...fixture(),...patch}));
});
test('height exaggeration pivots at the measured minimum and leaves true scale unchanged', () => {
  assert.equal(displayedHeight(16.885, 5, 1), 16.885);
  assert.equal(displayedHeight(8, 5, 2), 11);
  assert.equal(displayedHeight(8, 5, 4), 17);
  assert.throws(() => displayedHeight(8, 5, NaN));
});
