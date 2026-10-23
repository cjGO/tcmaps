// Offsets are signed fractions, retained when count or jitter changes.
export function linePlacements(start, end, count, jitter, offsets) {
  return pathPlacements([start, end], count, jitter, offsets);
}

export function pathPlacements(nodes, count, jitter, offsets) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Total number must be between 1 and 1000.');
  if (!Number.isFinite(jitter) || jitter < 0) throw new Error('Jitter must be a nonnegative distance in metres.');
  if (nodes.length < 2) throw new Error('Add at least two path points.');
  const segments = nodes.slice(1).map((end, i) => {
    const start = nodes[i], dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < .001) throw new Error('Consecutive path points must be distinct.');
    return {start, dx, dy, length};
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  return Array.from({ length: count }, (_, i) => {
    let distance = (count === 1 ? .5 : i / (count - 1)) * total, index = 0;
    while (index < segments.length - 1 && distance > segments[index].length) distance -= segments[index++].length;
    const {start, dx, dy, length} = segments[index];
    const t = Math.min(1, distance / length), offset = offsets[i] * jitter;
    return { x_m: start.x + dx * t - dy / length * offset, y_m: start.y + dy * t + dx / length * offset };
  });
}

export function lineScales(low, high, fractions) {
  if (![low, high].every(Number.isFinite) || low < .1 || high > 10 || low > high) {
    throw new Error('Scale range must be between 0.1 and 10, with low no greater than high.');
  }
  return fractions.map(fraction => low + (high - low) * fraction);
}

export function lineAssetScales(mix, overrides, fallback) {
  const scales = new Map();
  for (const asset of new Set(mix)) {
    const config = overrides.get(asset);
    if (!config?.enabled) continue;
    try { scales.set(asset, lineScales(config.low, config.high, config.fractions)); }
    catch (error) { throw new Error(`${asset}: ${error.message}`); }
  }
  return mix.map((asset, i) => scales.has(asset) ? scales.get(asset)[i] : fallback[i]);
}

export function shuffleLineAssets(mix, random = Math.random) {
  const shuffled = [...mix];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Avoid a no-op sample when there are multiple asset types.
  if (shuffled.every((asset, i) => asset === mix[i])) {
    const different = shuffled.findIndex(asset => asset !== shuffled[0]);
    if (different > 0) [shuffled[0], shuffled[different]] = [shuffled[different], shuffled[0]];
  }
  return shuffled;
}

// Round shares to whole objects, then spread each asset throughout the line.
export function lineAssetMix(entries, count) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Total number must be between 1 and 1000.');
  if (!entries.length) throw new Error('Select at least one favorite for the line.');
  if (entries.some(e => !Number.isFinite(e.ratio) || e.ratio <= 0)) throw new Error('Each selected asset needs a ratio greater than zero.');
  const max = Math.max(...entries.map(e => e.ratio));
  const total = entries.reduce((sum, e) => sum + e.ratio / max, 0);
  const shares = entries.map(e => count * (e.ratio / max) / total);
  const counts = shares.map(Math.floor);
  const order = entries.map((_, i) => i).sort((a, b) => (shares[b] - counts[b]) - (shares[a] - counts[a]));
  const remaining = count - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) counts[order[i]]++;
  const used = counts.map(() => 0);
  return Array.from({length:count}, (_, step) => {
    let best = -1, deficit = -Infinity;
    counts.forEach((n, i) => {
      const value = (step + 1) * n / count - used[i];
      if (used[i] < n && value > deficit) { best = i; deficit = value; }
    });
    used[best]++;
    return entries[best].asset;
  });
}
