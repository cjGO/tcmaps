import { groundHeight } from './editor-spatial.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function explorerPosition(data, x, y) {
  // Keep the eye's ground point inside the actual rendered sample mesh.
  return { x: clamp(x, data.xs[0] + .3, data.xs.at(-1) - .3), y: clamp(y, data.ys[0] + .3, data.ys.at(-1) - .3) };
}
export function createExplorerState(data, point, yaw = 0) {
  if (![point.x, point.y, yaw].every(Number.isFinite)) throw new Error('Invalid explorer start');
  const xy = explorerPosition(data, point.x, point.y), ground = groundHeight(data, xy.x, xy.y);
  return { ...xy, ground, z: ground, yaw, pitch: 0, eyeHeight: 1.7, verticalVelocity: 0, airborne: false, speed: 0 };
}
export function turnExplorer(state, dx, dy) {
  return { ...state, yaw: state.yaw + dx, pitch: clamp(state.pitch + dy, -Math.PI * .46, Math.PI * .46) };
}
export function stepExplorer(data, state, input, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid frame time');
  const dt = Math.min(seconds, .05);
  let forward = clamp(input.forward || 0, -1, 1), right = clamp(input.right || 0, -1, 1);
  const length = Math.hypot(forward, right);
  if (length > 1) { forward /= length; right /= length; }
  const speed = clamp(Number.isFinite(input.speed) ? input.speed : 6, 6, 30);
  const xy = explorerPosition(data,
    state.x + (Math.sin(state.yaw) * forward + Math.cos(state.yaw) * right) * speed * dt,
    state.y + (Math.cos(state.yaw) * forward - Math.sin(state.yaw) * right) * speed * dt);
  const ground = groundHeight(data, xy.x, xy.y);
  let z = state.z, velocity = state.verticalVelocity, airborne = state.airborne;
  if (input.jump && !airborne) { airborne = true; velocity = 4.2; z = ground; }
  if (airborne) {
    z += velocity * dt - .5 * 9.81 * dt * dt; velocity -= 9.81 * dt;
    if (z <= ground) { z = ground; velocity = 0; airborne = false; }
  } else z = ground;
  return { ...state, ...xy, ground, z, verticalVelocity: velocity, airborne,
    speed: dt ? Math.hypot(xy.x - state.x, xy.y - state.y) / dt : 0 };
}

export function hazeRange({ exploring, overhead, distance, span, enabled = true }) {
  if (!enabled || overhead) return { near: 100000, far: 200000 };
  if (exploring) return { near: 100, far: Math.max(1200, span * 2.5) };
  return { near: Math.max(100, distance - span * .4), far: distance + span * 2.8 };
}
