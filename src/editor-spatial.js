// Same triangle diagonal as terrainGeometry; heights remain in world metres.
export function groundHeight(data, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid terrain position');
  function cell(axis, value) {
    const v = Math.max(axis[0], Math.min(axis.at(-1), value));
    let lo = 0, hi = axis.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (axis[m] <= v) lo = m; else hi = m; }
    return [lo, (v - axis[lo]) / (axis[lo + 1] - axis[lo])];
  }
  const [i, u] = cell(data.xs, x), [j, v] = cell(data.ys, y), n = data.grid_size;
  const a = data.heights_mm[i * n + j], b = data.heights_mm[(i + 1) * n + j];
  const c = data.heights_mm[i * n + j + 1], d = data.heights_mm[(i + 1) * n + j + 1];
  return (u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - v) * (b - d) + (1 - u) * (c - d)) / 1000;
}

export function placementTransform(data, point, asset) {
  if (![point.x_m, point.y_m, point.yaw_deg, point.scale, point.z_offset_m ?? 0, asset.ground_offset_m].every(Number.isFinite) || point.scale < .1 || point.scale > 10) throw new Error('Invalid placement transform');
  return { position: [point.x_m, point.y_m, groundHeight(data, point.x_m, point.y_m) + asset.ground_offset_m * point.scale + (point.z_offset_m ?? 0)],
    yaw: point.yaw_deg * Math.PI / 180, scale: point.scale };
}

export function decodeMesh(buffer, model) {
  if (buffer.byteLength !== model.bytes || buffer.byteLength % 4) throw new Error('Incomplete model geometry');
  let end = 0;
  const parts = model.parts.map(part => {
    if (![part.vertex_count, part.index_count, part.vertex_offset, part.index_offset].every(Number.isInteger)
        || part.vertex_count < 1 || part.index_count < 3 || part.index_count % 3 || part.vertex_offset !== end
        || part.index_offset !== part.vertex_offset + part.vertex_count * 48) throw new Error('Invalid model layout');
    end = part.index_offset + part.index_count * 4;
    if (end > buffer.byteLength) throw new Error('Truncated model');
    const vertices = new Float32Array(buffer, part.vertex_offset, part.vertex_count * 12);
    const indices = new Uint32Array(buffer, part.index_offset, part.index_count);
    if (vertices.some(v => !Number.isFinite(v)) || indices.some(v => v >= part.vertex_count)) throw new Error('Invalid model vertices');
    return { ...part, vertices, indices };
  });
  if (!parts.length || end !== buffer.byteLength) throw new Error('Unexpected model data');
  return parts;
}
