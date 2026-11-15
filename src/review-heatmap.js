// Matplotlib's terrain colour stops, also used by the rotation heatmap plots.
export const terrainStops = [
  [0, [0.2, 0.2, 0.6]],
  [0.15, [0, 0.6, 1]],
  [0.25, [0, 0.8, 0.4]],
  [0.5, [1, 1, 0.6]],
  [0.75, [0.5, 0.36, 0.33]],
  [1, [1, 1, 1]],
];

export function terrainColor(height, scale) {
  const fraction = Math.max(0, Math.min(1, (height - scale.min_m) / (scale.max_m - scale.min_m)));
  const end = terrainStops.findIndex(([position], i) => i > 0 && position >= fraction);
  const [a, start] = terrainStops[end - 1], [b, finish] = terrainStops[end];
  const t = (fraction - a) / (b - a);
  return start.map((value, i) => Math.round(255 * (value + t * (finish[i] - value))));
}

export function renderHeatmapFrame(svg, grid, scale, name) {
  const doc = svg.ownerDocument;
  const node = (tag, attrs = {}, text) => {
    const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  svg.replaceChildren();
  const label = (x, y, text, attrs = {}) => svg.append(node('text', {x, y, 'text-anchor': 'middle', ...attrs}, text));
  const line = (x1, y1, x2, y2, attrs = {}) => svg.append(node('line', {x1, y1, x2, y2, stroke: '#303a40', ...attrs}));
  label(482, 27, name, {'font-size': 20, 'font-weight': 600});
  const b = grid.bounds;
  const x = value => 80 + (value - b.x_min_m) / (b.x_max_m - b.x_min_m) * 804;
  const y = value => 45 + (b.y_max_m - value) / (b.y_max_m - b.y_min_m) * 804;
  // Fixed 100-metre ticks make distances comparable across candidates too.
  for (let value = Math.ceil(b.x_min_m / 100) * 100; value < b.x_max_m; value += 100) {
    line(x(value), 45, x(value), 849, {stroke: '#ffffff', 'stroke-opacity': 0.35});
    line(x(value), 849, x(value), 856);
    label(x(value), 878, value);
  }
  for (let value = Math.ceil(b.y_min_m / 100) * 100; value < b.y_max_m; value += 100) {
    line(80, y(value), 884, y(value), {stroke: '#ffffff', 'stroke-opacity': 0.35});
    line(73, y(value), 80, y(value));
    label(65, y(value) + 6, value, {'text-anchor': 'end'});
  }
  svg.append(node('rect', {x: 80, y: 45, width: 804, height: 804, fill: 'none', stroke: '#303a40'}));
  label(482, 913, 'X (m)');
  label(24, 447, 'Y (m)', {transform: 'rotate(-90 24 447)'});
  const gradient = node('linearGradient', {id: 'review-elevation-gradient', x1: 0, y1: 1, x2: 0, y2: 0});
  for (const [position, color] of terrainStops) {
    gradient.append(node('stop', {offset: `${position * 100}%`, 'stop-color': `rgb(${color.map(c => Math.round(c * 255)).join(',')})`}));
  }
  const defs = node('defs'); defs.append(gradient); svg.append(defs);
  svg.append(node('rect', {x: 910, y: 45, width: 26, height: 804, fill: 'url(#review-elevation-gradient)', stroke: '#303a40'}));
  const ticks = [scale.min_m];
  for (let value = Math.ceil(scale.min_m / 20) * 20; value < scale.max_m; value += 20) {
    if (value - scale.min_m > 4 && scale.max_m - value > 4) ticks.push(value);
  }
  ticks.push(scale.max_m);
  for (const value of ticks) {
    const py = 849 - (value - scale.min_m) / (scale.max_m - scale.min_m) * 804;
    line(936, py, 942, py);
    label(947, py + 6, Number(value.toFixed(2)), {'text-anchor': 'start', 'data-elevation-tick': value});
  }
  label(1021, 447, 'Elevation (m)', {transform: 'rotate(-90 1021 447)'});
}
