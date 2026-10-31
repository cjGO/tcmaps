import * as THREE from 'three';
import { normalizedDensity } from './rotation-density.js';

export function createDensityLayer(geometry, data) {
  const b = data.bounds;
  const pixels = new Uint8Array(128 * 128 * 4);
  const texture = new THREE.DataTexture(pixels, 128, 128, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { density: { value: texture }, movementOpacity: { value: 0 }, deathOpacity: { value: 0 },
      bounds: { value: new THREE.Vector4(b.x_min_m, b.y_min_m, b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m) } },
    vertexShader: `uniform vec4 bounds; varying vec2 densityUV;
      void main(){densityUV=(position.xy-bounds.xy)/bounds.zw;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform sampler2D density; uniform float movementOpacity,deathOpacity; varying vec2 densityUV;
      void main(){
        vec2 d=texture2D(density,densityUV).rg;
        float m=d.r*movementOpacity, k=d.g*deathOpacity;
        vec3 movement=mix(vec3(.0,.35,1.),vec3(.1,1.,.65),smoothstep(.0,.5,d.r));
        movement=mix(movement,vec3(1.,.95,.1),smoothstep(.5,1.,d.r));
        vec3 death=mix(vec3(1.,.4,.05),vec3(1.,.0,.35),d.g);
        float alpha=1.-(1.-m)*(1.-k);
        if(alpha<.003)discard;
        gl_FragColor=vec4((movement*m+death*k)/max(m+k,.001),alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 1; mesh.visible = false;
  let lastResult, lastSmoothing, lastContrast;
  return { mesh,
    update(result, settings) {
      mesh.visible = !!result && (settings.movement || settings.deaths);
      if (!mesh.visible) return;
      if (result !== lastResult || settings.smoothing !== lastSmoothing || settings.contrast !== lastContrast) {
        const movement = normalizedDensity(result.movement, result.size, result.bounds, settings.smoothing, settings.contrast);
        const deaths = normalizedDensity(result.deaths, result.size, result.bounds, settings.smoothing, settings.contrast);
        for (let i = 0; i < movement.length; i++) { pixels[i * 4] = movement[i]; pixels[i * 4 + 1] = deaths[i]; pixels[i * 4 + 3] = 255; }
        texture.needsUpdate = true;
        lastResult = result; lastSmoothing = settings.smoothing; lastContrast = settings.contrast;
      }
      material.uniforms.movementOpacity.value = settings.movement ? settings.movementOpacity : 0;
      material.uniforms.deathOpacity.value = settings.deaths ? settings.deathOpacity : 0;
    },
    dispose() { texture.dispose(); material.dispose(); },
  };
}
