// Session-only visual guides. These never enter the editor document or sweep storage.
export function attachSpawnMeasurements(frame, initial = [], onChange = () => {}) {
  const doc = frame.contentDocument, win = frame.contentWindow, api = win.MapEditor;
  const svg = doc.getElementById('overlay'), C = win.MapCoordinates;
  const project = JSON.parse(doc.getElementById('project-data').textContent);
  let measurements = structuredClone(initial), measuring = false, drag = null;
  const button = doc.createElement('button'); button.textContent = 'Measure distance'; button.setAttribute('aria-pressed', 'false');
  const clear = doc.createElement('button'); clear.textContent = 'Clear measurements';
  const hint = doc.createElement('p'); hint.className = 'hint'; hint.setAttribute('role', 'status');
  doc.querySelector('.toolbar').append(button, clear);
  doc.querySelector('.toolbar').after(hint);
  const node = (tag, attrs) => {
    const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  function render() {
    svg.querySelector('[data-measurements]')?.remove();
    const group = node('g', { 'data-measurements': '', 'pointer-events': 'none' });
    const c = project.calibration, factor = c.width_px / (svg.getBoundingClientRect().width || c.width_px);
    const position = p => { const {u,v} = C.worldToImage(p.x_m,p.y_m,c); return {x:u*c.width_px,y:v*c.height_px}; };
    const spawns = api.getState().document.spawn_points;
    for (const [index, measurement] of measurements.entries()) {
      const b = position(measurement.target);
      for (const origin of spawns) {
        const a = position(origin), color = origin.team === 0 ? '#004bba' : '#b51629';
        group.append(node('line', {x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#fff','stroke-width':5*factor}));
        group.append(node('line', {x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:color,'stroke-width':2*factor,'stroke-dasharray':`${6*factor} ${4*factor}`}));
        const label = node('text', {x:(a.x+b.x)/2,y:(a.y+b.y)/2-9*factor,'text-anchor':'middle','font-size':14*factor,'font-weight':'bold',fill:color,stroke:'#fff','stroke-width':4*factor,'paint-order':'stroke'});
        label.textContent = `T${origin.team+1}: ${Math.hypot(measurement.target.x_m-origin.x_m,measurement.target.y_m-origin.y_m).toFixed(1)} m`;
        group.append(label);
      }
      const handle = node('circle', {cx:b.x,cy:b.y,r:8*factor,fill:'#5e2e86',stroke:'#fff','stroke-width':2*factor,'data-measurement-end':index,'pointer-events':'all',cursor:'grab'});
      const title = node('title', {}); title.textContent = 'Drag to move; double-click to delete measurement spot'; handle.append(title); group.append(handle);
    }
    svg.append(group); clear.disabled = !measurements.length;
  }
  function instructions() {
    button.setAttribute('aria-pressed', String(measuring));
    hint.textContent = measuring
      ? 'Click the map to measure from both spawns. Drag a purple spot to move it; double-click it to delete. Esc exits.'
      : 'Drag purple spots to adjust distances; double-click a spot to delete. Guides stay while switching maps in this session; they are excluded from exports.';
    render();
  }
  button.onclick = () => { measuring = !measuring; instructions(); };
  clear.onclick = () => { finish(true); measurements = []; onChange([]); instructions(); };
  function pick(event) {
    if (event.button !== 0 || drag) return;
    const endpoint = event.target.closest('[data-measurement-end]');
    if (endpoint) {
      event.preventDefault(); event.stopImmediatePropagation();
      const index = Number(endpoint.dataset.measurementEnd);
      drag = { index, pointer: event.pointerId, before: {...measurements[index].target} };
      svg.setPointerCapture(event.pointerId);
      hint.textContent = 'Drag the endpoint to update the distance. Esc cancels.';
      return;
    }
    if (!measuring) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const marker = event.target.closest('[data-spawn]');
    const rect = svg.getBoundingClientRect();
    const target = marker
      ? api.getState().document.spawn_points.find(p => p.team === Number(marker.dataset.spawn))
      : C.imageToWorld((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,project.calibration);
    if (!C.inside(target.x_m,target.y_m,project.bounds)) { hint.textContent = 'Choose a destination inside the map border.'; return; }
    measurements.push({target:{x_m:target.x_m,y_m:target.y_m}});
    onChange(structuredClone(measurements)); instructions();
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const rect = svg.getBoundingClientRect();
    const target = C.imageToWorld((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,project.calibration);
    if (!C.inside(target.x_m,target.y_m,project.bounds)) return;
    measurements[drag.index].target = target;
    onChange(structuredClone(measurements)); render();
  }
  function finish(cancel = false) {
    if (!drag) return;
    const current = drag; drag = null;
    if (cancel) measurements[current.index].target = current.before;
    if (svg.hasPointerCapture?.(current.pointer)) svg.releasePointerCapture(current.pointer);
    onChange(structuredClone(measurements)); instructions();
  }
  function end(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    finish(event.type !== 'pointerup');
  }
  function removeSpot(event) {
    const rect = svg.getBoundingClientRect();
    const handle = event.target.closest('[data-measurement-end]');
    // Pointer capture and redraws can retarget double-clicks to the SVG itself.
    const index = handle ? Number(handle.dataset.measurementEnd) : measurements.findLastIndex(({target}) => {
      const {u,v} = C.worldToImage(target.x_m,target.y_m,project.calibration);
      return Math.hypot(event.clientX-rect.left-u*rect.width,event.clientY-rect.top-v*rect.height) <= 12;
    });
    if (index < 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); finish(true);
    measurements.splice(index,1); onChange(structuredClone(measurements)); instructions();
  }
  function key(event) {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
    if (event.key === 'Escape' && measuring) { measuring = false; instructions(); }
  }
  svg.addEventListener('dblclick', removeSpot, true);
  svg.addEventListener('pointermove', move, true);
  for (const type of ['pointerup','pointercancel','lostpointercapture']) svg.addEventListener(type, end, true);
  svg.addEventListener('pointerdown', pick, true); doc.addEventListener('keydown', key);
  const unsubscribe = api.subscribe(render);
  const observer = new win.ResizeObserver(render); observer.observe(svg);
  instructions();
  return { dispose() { svg.removeEventListener('dblclick',removeSpot,true); finish(true); unsubscribe(); svg.removeEventListener('pointermove',move,true); for (const type of ['pointerup','pointercancel','lostpointercapture']) svg.removeEventListener(type,end,true); observer.disconnect(); svg.removeEventListener('pointerdown',pick,true); doc.removeEventListener('keydown',key); button.remove(); clear.remove(); hint.remove(); svg.querySelector('[data-measurements]')?.remove(); } };
}
