import * as THREE from 'three';
import { createExperimentalLayer } from './experimental-replay-layer.js';
import { eventIndex, experimentalPose } from './experimental-replay.js';
import { displayedHeight } from './terrain-geometry.js';
import { inferredFrame, pathPose, pathVisible, participant } from './replay-v3-model.js';
import { matchesDisplay } from './experimental-replay-presentation.js';

// The established combat/movement layer is composed unchanged. Everything here
// is presentation derived from the original events, including the smoke.
export function createReplayV3Layer(viewer, data, replay, { combat, ...options }) {
  const base = createExperimentalLayer(viewer, data, replay, options);
  const group = new THREE.Group(), dummy = new THREE.Object3D(), max = 512;
  group.name = 'replay-v3-inference';
  const z = value => displayedHeight(value, data.min_height_m, viewer.heightScale);
  const headGeo = new THREE.SphereGeometry(.65, 6, 4), headMat = new THREE.MeshBasicMaterial({ color: '#fff0ac' });
  const heads = new THREE.InstancedMesh(headGeo, headMat, max);
  heads.frustumCulled = false; heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(heads);
  const lineGeo = new THREE.BufferGeometry(), vertices = new Float32Array((max * 2 + 2) * 6), colors = new Float32Array((max * 2 + 2) * 8);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85 });
  const lines = new THREE.LineSegments(lineGeo, lineMat); lines.frustumCulled = false; group.add(lines);
  const ghostGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const ghostMat = new THREE.LineDashedMaterial({ color: '#ffe4a0', dashSize: 2, gapSize: 1.5, transparent: true, opacity: .65 });
  const ghost = new THREE.Line(ghostGeo, ghostMat); ghost.frustumCulled = false; group.add(ghost);
  // Soft instanced billboards: bounded draw count, deterministic on reverse seek.
  const smokeGeo = new THREE.PlaneGeometry(1, 1), alphas = new Float32Array(max * 2);
  smokeGeo.setAttribute('alpha', new THREE.InstancedBufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  const smokeMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    vertexShader: `attribute float alpha; varying vec2 vUv; varying float vAlpha;
      void main(){vUv=uv;vAlpha=alpha;vec4 p=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
      p.xy+=position.xy*length(instanceMatrix[0].xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec2 vUv; varying float vAlpha;
      void main(){float r=length(vUv-.5)*2.;float a=(1.-smoothstep(.1,1.,r))*vAlpha;
      if(a<.005)discard;gl_FragColor=vec4(vec3(.78,.8,.77),a);}` });
  const smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, max * 2); smoke.frustumCulled = false; smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(smoke);
  const shots = replay.byType.shot || [], shotMeta = new Map(shots.map(s => [s.seq, participant(replay, s.shooter, s)]));
  let state = { t: replay.first, seq: Infinity, density: 128, paths: true, smoke: true, selectedShot: null }, selected = [], lineCount = 0;
  function line(a, b, opacity, bright = false) {
    const offset = lineCount++ * 6;
    vertices.set([a.x, a.y, z(a.z) + .06, b.x, b.y, z(b.z) + .06], offset);
    const c = bright ? [1, .95, .7] : [1, .65, .16];
    colors.set([...c, opacity, ...c, opacity], (lineCount - 1) * 8);
  }
  function effects() {
    const { t, seq, layers = {} } = state, density = Math.min(max, Math.max(1, state.density || 128));
    heads.count = smoke.count = lineCount = 0; selected = []; let pathCount = 0;
    if (state.paths !== false) for (const frame of inferredFrame(combat, t, seq, { ...state, density })) {
      const { path, position, opacity, arrived } = frame;
      pathCount++;
      line(path.from, position, opacity * .65);
      if (!arrived) {
        line(pathPose(path, t - Math.min(70, path.duration * .25)), position, 1, true);
        dummy.position.set(position.x, position.y, z(position.z) + .08); dummy.scale.setScalar(1); dummy.updateMatrix();
        heads.setMatrixAt(heads.count++, dummy.matrix); selected.push(path.id);
      }
    }
    const pinned = combat.byShot.get(Number(state.selectedShot));
    ghost.visible = !!(state.paths !== false && pinned && pathVisible(pinned, state));
    if (ghost.visible) {
      const attribute = ghostGeo.attributes.position;
      attribute.setXYZ(0, pinned.from.x, pinned.from.y, z(pinned.from.z) + .1);
      attribute.setXYZ(1, pinned.to.x, pinned.to.y, z(pinned.to.z) + .1);
      attribute.needsUpdate = true; ghost.computeLineDistances();
    }
    if (state.smoke !== false && layers.shots !== false) {
      const end = eventIndex(shots, t, seq);
      for (let i = end, count = 0; i >= 0 && shots[i].t >= t - 2200 && count < density; i--) {
        const shot = shots[i]; if (!matchesDisplay(shotMeta.get(shot.seq), state)) continue;
        const age = (t - shot.t) / 1000, p = experimentalPose(shot.position), seed = (shot.seq * 16807 % 997) / 997;
        for (let puff = 0; puff < 2; puff++) {
          const n = smoke.count++;
          dummy.position.set(p.x + (seed - .5) * age * (puff + 1), p.y + (.5 - seed) * age, z(p.z + age * .65 + puff * .5));
          dummy.scale.setScalar(1.1 + age * (3 + puff)); dummy.updateMatrix(); smoke.setMatrixAt(n, dummy.matrix);
          alphas[n] = Math.max(0, 1 - age / 2.2) * .19;
        }
        count++;
      }
    }
    heads.instanceMatrix.needsUpdate = smoke.instanceMatrix.needsUpdate = true;
    heads.boundingSphere = smoke.boundingSphere = null; smokeGeo.attributes.alpha.needsUpdate = true;
    lineGeo.setDrawRange(0, lineCount * 2); lineGeo.attributes.position.needsUpdate = lineGeo.attributes.color.needsUpdate = true;
    return { inferredPaths: pathCount, smokePuffs: smoke.count };
  }
  function update(next = {}) { state = { ...state, ...next }; const extra = effects(); return { ...base.update(state), ...extra }; }
  function focus(ref) {
    const volley = combat.volleys.find(v => v.id === ref.volley);
    if (volley) {
      const points = volley.shots.map(id => experimentalPose(replay.records[id - 1].position));
      const box = new THREE.Box3().setFromPoints(points.map(p => new THREE.Vector3(p.x, p.y, z(p.z))));
      box.expandByScalar(35); viewer.focus(box); return true;
    }
    const path = combat.byShot.get(Number(ref.shot));
    if (!path) return base.focus(ref);
    const box = new THREE.Box3().setFromPoints([path.from, path.to].map(p => new THREE.Vector3(p.x, p.y, z(p.z))));
    box.expandByScalar(12); viewer.focus(box); return true;
  }
  let down;
  const pointerDown = e => { down = [e.clientX, e.clientY]; };
  const pointerUp = e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const hit = viewer.pick(e.clientX, e.clientY, [heads])[0];
    if (hit) options.select?.({ shot: selected[hit.instanceId] });
  };
  viewer.canvas.addEventListener('pointerdown', pointerDown); viewer.canvas.addEventListener('pointerup', pointerUp);
  viewer.addLayer(group); effects();
  const unsubscribe = viewer.onHeightChange(() => { effects(); viewer.draw(false); });
  return { update, focus, heatmap: base.heatmap, dispose() {
    unsubscribe(); viewer.canvas.removeEventListener('pointerdown', pointerDown); viewer.canvas.removeEventListener('pointerup', pointerUp);
    group.removeFromParent(); base.dispose();
    for (const resource of [headGeo, headMat, heads, lineGeo, lineMat, ghostGeo, ghostMat, smokeGeo, smokeMat, smoke]) resource.dispose();
  } };
}
