import * as THREE from 'three';
import { normalizedDensity, differenceDensity } from './rotation-density.js';

export function createDensityLayer(geometry, data) {
  const b = data.bounds;
  const pixels = new Uint8Array(128 * 128 * 4);
  const texture = new THREE.DataTexture(pixels, 128, 128, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { comparison: { value: false }, comparisonOpacity: { value: .8 }, density: { value: texture }, movementOpacity: { value: 0 }, deathOpacity: { value: 0 },
      bounds: { value: new THREE.Vector4(b.x_min_m, b.y_min_m, b.x_max_m - b.x_min_m, b.y_max_m - b.y_min_m) } },
    vertexShader: `uniform vec4 bounds; varying vec2 densityUV;
      void main(){densityUV=(position.xy-bounds.xy)/bounds.zw;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform sampler2D density; uniform float movementOpacity,deathOpacity,comparisonOpacity; uniform bool comparison; varying vec2 densityUV;
      void main(){
        vec2 d=texture2D(density,densityUV).rg;
        if(comparison){
          float difference=d.r-d.g;
          float alpha=abs(difference)*comparisonOpacity;
          if(alpha<.003)discard;
          vec3 color=difference>0.?vec3(1.,.43,.08):vec3(.12,.4,1.);
          gl_FragColor=vec4(color,alpha);return;
        }
        float m=d.r*movementOpacity, k=d.g*deathOpacity;
        vec3 movement=mix(vec3(.0,.35,1.),vec3(.1,1.,.65),smoothstep(.0,.5,d.r));
        movement=mix(movement,vec3(1.,.95,.1),smoothstep(.5,1.,d.r));
        vec3 death=mix(vec3(66.,10.,104.)/255.,vec3(165.,44.,132.)/255.,clamp(d.g*4.,0.,1.));
        death=mix(death,vec3(233.,81.,74.)/255.,clamp(d.g*4.-1.,0.,1.));
        death=mix(death,vec3(251.,159.,58.)/255.,clamp(d.g*4.-2.,0.,1.));
        death=mix(death,vec3(252.,247.,178.)/255.,clamp(d.g*4.-3.,0.,1.));
        float alpha=1.-(1.-m)*(1.-k);
        if(alpha<.003)discard;
        gl_FragColor=vec4((movement*m+death*k)/max(m+k,.001),alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 1; mesh.visible = false;
  let lastResult, lastSignature;
  return { mesh,
    update(result, settings) {
      const comparing = !!settings.comparison && !!result?.comparison;
      mesh.visible = !!result && (settings.comparison ? comparing && result.comparison.source.rounds > 0 && result.comparison.target.rounds > 0 : settings.movement || settings.deaths);
      if (!mesh.visible) return;
      const signature = JSON.stringify([comparing, settings.compareMetric, settings.compareScale, settings.smoothing, settings.contrast]);
      if (result !== lastResult || signature !== lastSignature) {
        let movement, deaths;
        if (comparing) {
          const delta = differenceDensity(result.comparison, settings.compareMetric, settings.compareScale, settings.smoothing, settings.contrast);
          movement = delta.positive; deaths = delta.negative;
        } else {
          movement = normalizedDensity(result.movement, result.size, result.bounds, settings.smoothing, settings.contrast);
          deaths = normalizedDensity(result.deaths, result.size, result.bounds, settings.smoothing, settings.contrast);
        }
        for (let i = 0; i < movement.length; i++) { pixels[i * 4] = movement[i]; pixels[i * 4 + 1] = deaths[i]; pixels[i * 4 + 3] = 255; }
        texture.needsUpdate = true;
        lastResult = result; lastSignature = signature;
      }
      material.uniforms.comparison.value = comparing;
      material.uniforms.comparisonOpacity.value = settings.compareOpacity ?? .8;
      material.uniforms.movementOpacity.value = settings.movement ? settings.movementOpacity : 0;
      material.uniforms.deathOpacity.value = settings.deaths ? settings.deathOpacity : 0;
    },
    dispose() { texture.dispose(); material.dispose(); },
  };
}
