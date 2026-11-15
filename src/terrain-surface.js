import * as THREE from 'three';
import { elevationPalettes } from './terrain-palettes.js';

export function createTerrainSurface(data) {
  const region = Number((BigInt(data.source.terrain_code) >> 156n) & 15n);
  const snow = region === 4 || region === 12, desert = region === 5 || region === 13;
  const base = snow ? '#c5cfce' : desert ? '#b7a17c' : '#8b9273';
  const earth = snow ? '#8d9692' : desert ? '#978067' : '#8b8068';
  const [low, mid, high] = elevationPalettes.terrain.colors;
  const sharedScale = data.elevation_stops ? data.colour_scale : null;
  const uniforms = {
    terrainLow: { value: sharedScale?.min_m ?? data.min_height_m }, terrainHigh: { value: sharedScale?.max_m ?? data.max_height_m },
    contourAmount: { value: 0 }, elevationMode: { value: 0 },
    earthColor: { value: new THREE.Color(earth) }, baseColor: { value: new THREE.Color(base) },
    lowColor: { value: new THREE.Color(low) }, midColor: { value: new THREE.Color(mid) }, highColor: { value: new THREE.Color(high) },
  };
  let elevationExpression='h<.5?mix(lowColor,midColor,h*2.0):mix(midColor,highColor,(h-.5)*2.0)';
  if (data.elevation_stops) {
    const vector=color=>{
      const linear=new THREE.Color().setRGB(...color,THREE.SRGBColorSpace);
      return `vec3(${[linear.r,linear.g,linear.b].map(v=>v.toFixed(6)).join(',')})`;
    };
    elevationExpression=vector(data.elevation_stops.at(-1)[1]);
    for(let i=data.elevation_stops.length-2;i>=0;i--){
      const [a,start]=data.elevation_stops[i], [b,end]=data.elevation_stops[i+1];
      elevationExpression=`h<=${b.toFixed(6)}?mix(${vector(start)},${vector(end)},(h-${a.toFixed(6)})/${(b-a).toFixed(6)}):(${elevationExpression})`;
    }
  }
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float elevation; varying float terrainHeight; varying vec2 terrainXY; varying float terrainSlope;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nterrainHeight=elevation; terrainXY=position.xy; terrainSlope=1.0-abs(normal.z);');
    shader.fragmentShader = `uniform float terrainLow,terrainHigh,contourAmount,elevationMode;
      uniform vec3 earthColor,baseColor,lowColor,midColor,highColor;
      varying float terrainHeight; varying vec2 terrainXY; varying float terrainSlope;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float h=clamp((terrainHeight-terrainLow)/max(terrainHigh-terrainLow,.001),0.0,1.0);
      vec3 elevationColor=${elevationExpression};
      float terrainPattern=.5+.25*sin(terrainXY.x*.021+sin(terrainXY.y*.018))+.25*sin(terrainXY.y*.031);
      vec3 natural=mix(baseColor,earthColor,clamp(terrainSlope*2.5+terrainPattern*.13,0.0,.72));
      diffuseColor.rgb*=mix(natural,elevationColor,elevationMode);
      float line=abs(fract(terrainHeight/2.0+.5)-.5)/max(fwidth(terrainHeight/2.0),.0001);
      diffuseColor.rgb*=1.0-(1.0-smoothstep(.45,1.25,line))*contourAmount*.23;
    `);
  };
  material.customProgramCacheKey = () => 'measured-terrain-sunlight-v2:' + elevationExpression;
  return { material,
    palette(value) {
      const colors = elevationPalettes[value].colors;
      ['lowColor', 'midColor', 'highColor'].forEach((name, index) => uniforms[name].value.set(colors[index]));
    },
    contours(value) { uniforms.contourAmount.value = value ? 1 : 0; },
    elevation(value) { uniforms.elevationMode.value = value ? 1 : 0; },
  };
}
