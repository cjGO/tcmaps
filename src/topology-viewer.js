import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { terrainGeometry, displayedHeight } from './terrain-geometry.js';
import { createTerrainSurface } from './terrain-surface.js';
import { createTerrainExperience } from './terrain-experience.js';
import { hazeRange } from './terrain-explorer-motion.js';
import experienceStyles from './terrain-experience.css?inline';

export function createTopologyViewer(container, data, onError, options = {}) {
  let renderer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c4d5df');
  scene.fog = new THREE.Fog(scene.background, 100, 2000);
  let camera, controls, observer, disposed = false, scale = 1, activeView = 'aerial';
  let navigation = true, enabled = true, activeSpawns = data.spawns, terrain;
  let experience, returnView, contoursEnabled = false;
  const graphics = { surface: 'elevation', palette: 'terrain', haze: true, fog: 'source', sun: 135, shadows: true };
  const raycaster = new THREE.Raycaster();
  const geometry = new THREE.BufferGeometry();
  const surface = createTerrainSurface(data), material = surface.material;
  const sun = new THREE.DirectionalLight('#fff0d5', 2.8);
  const markers = [], resources = [];
  const heightListeners = new Set();
  const followEndListeners = new Set();
  let positions, baseHeights, boundary, canvas;
  const b = data.bounds;
  const cx = (b.x_min_m + b.x_max_m) / 2, cy = (b.y_min_m + b.y_max_m) / 2;
  const span = Math.max(b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m);
  const minimum = data.min_height_m;
  const z = h => displayedHeight(h, minimum, scale);
  function draw(updateShadows = true) {
    if (disposed || !camera || !renderer || !container.clientWidth || !container.clientHeight) return;
    const range = hazeRange({ exploring: experience?.mode === 'explore', overhead: camera.isOrthographicCamera,
      distance: controls ? camera.position.distanceTo(controls.target) : span, span, enabled: graphics.haze && graphics.fog !== 'none' });
    const fogDistance = { low: 600, medium: 450, dense: 300 }[graphics.fog];
    const mapFog = fogDistance !== undefined;
    scene.fog.color.set(mapFog ? '#ffffff' : '#c4d5df');
    scene.background.copy(scene.fog.color);
    scene.fog.near = mapFog ? 0 : range.near;
    scene.fog.far = mapFog ? fogDistance : range.far;
    if (updateShadows) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }
  function configureControls() {
    if (!controls) return;
    controls.enabled = enabled && (!experience || experience.mode === 'orbit');
    controls.mouseButtons.LEFT = navigation ? THREE.MOUSE.ROTATE : null;
    controls.mouseButtons.RIGHT = navigation ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = navigation ? THREE.MOUSE.DOLLY : THREE.MOUSE.PAN;
    controls.touches.ONE = navigation ? THREE.TOUCH.ROTATE : null;
  }
  function pick(clientX, clientY, objects = [terrain]) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), camera);
    return raycaster.intersectObjects(objects, true);
  }
  function resize() {
    if (!camera || disposed) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    if (camera.isPerspectiveCamera) camera.aspect = w / h;
    else { const height = span * 1.18 * Math.max(1, h / w); camera.left = -height * w / h / 2; camera.right = -camera.left; camera.top = height / 2; camera.bottom = -height / 2; }
    camera.updateProjectionMatrix(); draw(false);
  }
  function preset(name = 'aerial') {
    if (disposed) return;
    experience?.exit();
    activeView = name; controls?.dispose();
    camera = name === 'overhead' ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera(45, 1, .2, 10000);
    camera.near = .2; camera.far = 10000; camera.up.set(0, 0, 1);
    const centerHeight = data.heights_mm[Math.floor(data.grid_size / 2) * data.grid_size + Math.floor(data.grid_size / 2)] / 1000;
    const target = new THREE.Vector3(cx, cy, z((data.min_height_m + data.max_height_m) / 2));
    if (name === 'overhead') camera.position.set(cx, cy - .001, z(data.max_height_m) + span * 2);
    else if (name.startsWith('team')) {
      const spawn = activeSpawns[Number(name.slice(-1)) - 1];
      camera.fov = 68; camera.position.set(spawn.x_m, spawn.y_m, z(spawn.z_m) + 12);
      target.z = z(centerHeight) + 2;
    } else {
      const sign = name === 'reverse' ? -1 : 1;
      camera.position.copy(target).add(new THREE.Vector3(sign * .85, sign * -1, .85).multiplyScalar(span * 1.2));
      camera.lookAt(target); resize();
      // Fit the eight bounding corners to leave room around every edge.
      for (let attempt = 0; attempt < 30; attempt++) {
        camera.updateMatrixWorld();
        const corners = [b.x_min_m, b.x_max_m].flatMap(x => [b.y_min_m, b.y_max_m].flatMap(y => [z(data.min_height_m), z(data.max_height_m)].map(h => new THREE.Vector3(x, y, h).project(camera))));
        if (corners.every(p => Math.abs(p.x) < .88 && Math.abs(p.y) < .88)) break;
        camera.position.sub(target).multiplyScalar(1.08).add(target); camera.lookAt(target);
      }
    }
    controls = new OrbitControls(camera, canvas);
    controls.target.copy(target); controls.minDistance = options.editing ? .25 : 3; controls.maxDistance = span * 6;
    controls.maxPolarAngle = Math.PI * .495; controls.minZoom = .2; controls.maxZoom = options.editing ? 1000 : 15;
    configureControls();
    controls.listenToKeyEvents(canvas); controls.addEventListener('change', () => draw(false));
    for (const [index, marker] of markers.entries()) marker.visible = name !== `team${index + 1}`;
    controls.update(); resize();
  }
  function updateHeights(value) {
    scale = Number(value);
    // Validate before touching geometry or spawn positions.
    displayedHeight(minimum, minimum, scale);
    for (let i = 0; i < baseHeights.length; i++) positions[i * 3 + 2] = z(baseHeights[i]);
    geometry.attributes.position.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const n = data.grid_size, indices = [];
    for (let i = 0; i < n; i++) indices.push(i * n);
    for (let i = 1; i < n; i++) indices.push((n - 1) * n + i);
    for (let i = n - 2; i >= 0; i--) indices.push(i * n + n - 1);
    for (let i = n - 2; i >= 0; i--) indices.push(i);
    boundary.geometry.setFromPoints(indices.map(i => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2] + .12)));
    for (const [index, marker] of markers.entries()) marker.position.set(activeSpawns[index].x_m, activeSpawns[index].y_m, z(activeSpawns[index].z_m));
    if (renderer) renderer.shadowMap.needsUpdate = true;
    for (const listener of heightListeners) listener(scale);
  }
  function exaggeration(value) {
    experience?.exit(); updateHeights(value); preset(activeView);
  }
  function applyGraphics(next) {
    Object.assign(graphics, next);
    const angle = graphics.sun * Math.PI / 180;
    sun.position.set(cx + Math.cos(angle) * span, cy + Math.sin(angle) * span, minimum + span * .72);
    surface.elevation(graphics.surface === 'elevation');
    surface.palette(graphics.palette);
    sun.castShadow = graphics.shadows; renderer.shadowMap.enabled = graphics.shadows;
    draw();
  }
  function dispose() {
    if (disposed) return; disposed = true;
    heightListeners.clear();
    experience?.dispose(); observer?.disconnect(); controls?.dispose();
    canvas?.removeEventListener('webglcontextlost', lost);
    geometry.dispose(); material.dispose();
    for (const resource of resources) resource.dispose();
    sun.shadow.dispose();
    renderer?.dispose(); renderer?.forceContextLoss(); canvas?.remove();
  }
  function lost(event) { event.preventDefault(); onError('3D graphics were interrupted. Reopen 3D topology to retry.'); }
  try {
    const arrays = terrainGeometry(data); positions = arrays.positions;
    baseHeights = Float32Array.from(data.heights_mm, h => h / 1000);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('elevation', new THREE.BufferAttribute(baseHeights, 1));
    geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1)); geometry.computeVertexNormals();
    terrain = new THREE.Mesh(geometry, material); terrain.castShadow = terrain.receiveShadow = true; scene.add(terrain);
    const sky = new THREE.HemisphereLight('#cbdcec', '#756951', 1.1); sky.position.set(0, 0, 1); scene.add(sky);
    sun.target.position.set(cx, cy, minimum); scene.add(sun, sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -span * .8, right: span * .8, top: span * .8, bottom: -span * .8, near: 1, far: span * 3.5 });
    sun.shadow.bias = -.00012; sun.shadow.normalBias = .35;
    const edgeGeometry = new THREE.BufferGeometry(), edgeMaterial = new THREE.LineBasicMaterial({ color: '#365449' });
    boundary = new THREE.LineLoop(edgeGeometry, edgeMaterial); resources.push(edgeGeometry, edgeMaterial); scene.add(boundary);
    for (const [index] of data.spawns.entries()) {
      const marker = new THREE.Group(), color = index === 0 ? '#2e7be5' : '#e75a4d';
      const poleGeometry = new THREE.CylinderGeometry(.55, .55, 12, 8), poleMaterial = new THREE.MeshBasicMaterial({ color });
      const pole = new THREE.Mesh(poleGeometry, poleMaterial); pole.rotation.x = Math.PI / 2; pole.position.z = 6; marker.add(pole); resources.push(poleGeometry, poleMaterial);
      const label = document.createElement('canvas'); label.width = label.height = 96;
      const ctx = label.getContext('2d'); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(48, 48, 43, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(index + 1), 48, 50);
      const texture = new THREE.CanvasTexture(label), spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false });
      const sprite = new THREE.Sprite(spriteMaterial); sprite.position.z = 18; sprite.scale.set(17, 17, 1); marker.add(sprite);
      resources.push(texture, spriteMaterial); markers.push(marker); scene.add(marker);
    }
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    canvas = renderer.domElement; canvas.tabIndex = 0; canvas.classList.add('terrain-3d-surface');
    canvas.setAttribute('aria-label', 'Custom map 1 interactive topology. Drag to orbit, scroll to zoom, right-drag or arrow keys to pan.');
    container.append(canvas); canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) event.stopPropagation(); });
    observer = new ResizeObserver(resize); observer.observe(container);
    exaggeration(1);
    applyGraphics(graphics);
    experience = createTerrainExperience(container, data, {
      canvas, pick, spawns: () => activeSpawns, graphics: applyGraphics,
      followEnded() { for (const listener of followEndListeners) listener(); },
      begin() {
        returnView = { camera, scale, wireframe: material.wireframe };
        controls.enabled = false; updateHeights(1);
        camera = new THREE.PerspectiveCamera(60, 1, .08, 10000); camera.up.set(0, 0, 1);
        material.wireframe = false; surface.contours(false);
        for (const marker of markers) marker.visible = false;
        boundary.visible = false; resize();
      },
      frame(state) {
        const cosine = Math.cos(state.pitch);
        camera.position.set(state.x, state.y, state.z + state.eyeHeight);
        camera.lookAt(state.x + Math.sin(state.yaw) * cosine, state.y + Math.cos(state.yaw) * cosine, camera.position.z + Math.sin(state.pitch));
        draw(false);
      },
      end() {
        if (!returnView) return;
        camera = returnView.camera; updateHeights(returnView.scale); material.wireframe = returnView.wireframe;
        surface.contours(contoursEnabled); returnView = null;
        for (const [i, marker] of markers.entries()) marker.visible = activeView !== `team${i + 1}`;
        boundary.visible = true; configureControls(); resize(); draw();
      },
      modeChanged(mode) { configureControls(); options.onModeChange?.(mode); },
    }, experienceStyles);
    return { preset, exaggeration, dispose, resize, canvas, draw, pick,
      get mode() { return experience.mode; }, get following() { return experience.following; }, get heightScale() { return scale; },
      exitExplorer() { experience.exit(); }, pauseExplorer() { experience.pause(); },
      followSoldier(point) { experience.follow(point); },
      stopFollowing() { experience.exit(); },
      onFollowEnd(listener) { followEndListeners.add(listener); return () => followEndListeners.delete(listener); },
      addLayer(layer) { scene.add(layer); draw(); },
      onHeightChange(listener) { heightListeners.add(listener); return () => heightListeners.delete(listener); },
      navigation(value) { navigation = value; configureControls(); },
      enabled(value) { enabled = value; configureControls(); },
      updateSpawns(spawns) {
        activeSpawns = spawns;
        for (const [i, marker] of markers.entries()) marker.position.set(spawns[i].x_m, spawns[i].y_m, z(spawns[i].z_m));
        experience.refresh();
        draw();
      },
      focus(box) {
        experience.exit();
        if (box.isEmpty()) return;
        const sphere = box.getBoundingSphere(new THREE.Sphere()), radius = Math.max(.5, sphere.radius);
        const direction = camera.position.clone().sub(controls.target).normalize();
        controls.target.copy(sphere.center);
        if (camera.isPerspectiveCamera) {
          const halfFov = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
          camera.position.copy(sphere.center).addScaledVector(direction, radius / Math.sin(halfFov) * 1.3);
        } else {
          camera.position.copy(sphere.center).addScaledVector(direction, span * 2);
          camera.zoom = Math.min(controls.maxZoom, Math.min(camera.right - camera.left, camera.top - camera.bottom) / (radius * 2.6));
        }
        camera.updateProjectionMatrix(); controls.update(); draw();
      },
      contours(enabled) { contoursEnabled = enabled; surface.contours(enabled && experience.mode !== 'explore'); draw(false); },
      wireframe(enabled) { material.wireframe = enabled; draw(); } };
  } catch (error) { dispose(); throw error; }
}
