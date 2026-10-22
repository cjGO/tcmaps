export function terrainGeometry(data) {
  const n = data.grid_size;
  if (!Number.isInteger(n) || n < 2 || n > 501 || data.xs.length !== n || data.ys.length !== n || data.heights_mm.length !== n * n) throw new Error('Incomplete terrain grid');
  if (data.vertical_scale !== 1 || data.height_order !== 'x-major, y-minor') throw new Error('Unsupported terrain coordinates');
  for (const axis of [data.xs, data.ys]) {
    if (axis.some((v, i) => !Number.isFinite(v) || (i && v <= axis[i - 1]))) throw new Error('Invalid terrain axis');
  }
  const positions = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    const i = x * n + y;
    if (!Number.isFinite(data.heights_mm[i])) throw new Error('Invalid elevation');
    positions.set([data.xs[x], data.ys[y], data.heights_mm[i] / 1000], i * 3);
    uv.set([data.xs[x] / 18, data.ys[y] / 18], i * 2);
  }
  const indices = new Uint32Array((n - 1) ** 2 * 6);
  let cursor = 0;
  for (let x = 0; x < n - 1; x++) for (let y = 0; y < n - 1; y++) {
    const a = x * n + y;
    indices.set([a, a + n, a + 1, a + n, a + n + 1, a + 1], cursor);
    cursor += 6;
  }
  return { positions, uv, indices };
}

export function displayedHeight(height, minimum, scale) {
  if (![height, minimum, scale].every(Number.isFinite) || scale < 1 || scale > 4) throw new Error('Invalid height scale');
  return minimum + (height - minimum) * scale;
}
