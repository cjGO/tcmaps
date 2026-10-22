import * as THREE from 'three';
import { decodeMesh } from './editor-spatial.js';

export async function checkedBuffer(url, sha256, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load ' + new URL(url).pathname.split('/').at(-1));
  const buffer = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  if (Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') !== sha256) throw new Error('Asset checksum differs. Reload the editor.');
  return buffer;
}

export function createModelLibrary(manifest, baseURL) {
  if (manifest.schema_version !== 1 || manifest.units !== 'metres' || manifest.up_axis !== 'Z' || manifest.vertex_stride !== 12) throw new Error('Unsupported asset coordinates');
  const models = new Map(), textures = new Map(), resources = new Set(), controller = new AbortController();
  let disposed = false;
  async function texture(file) {
    if (textures.has(file)) return textures.get(file);
    const promise = (async () => {
      const meta = manifest.textures[file];
      if (!meta) throw new Error('Missing material texture');
      const bytes = await checkedBuffer(new URL(file, baseURL), meta.sha256, controller.signal);
      const blob = new Blob([bytes], { type: 'image/webp' }), url = URL.createObjectURL(blob);
      try {
        const t = await new THREE.TextureLoader().loadAsync(url);
        if (disposed) { t.dispose(); throw new Error('Editor closed'); }
        // Preserve native BRF UVs; image upload flips DDS-derived rows for WebGL.
        t.flipY = true; t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
        resources.add(t); return t;
      } finally { URL.revokeObjectURL(url); }
    })();
    textures.set(file, promise);
    promise.catch(() => textures.delete(file));
    return promise;
  }
  async function template(mesh) {
    if (models.has(mesh)) return models.get(mesh);
    const promise = (async () => {
      const meta = manifest.meshes[mesh];
      if (!meta) throw new Error('Missing model: ' + mesh);
      const bytes = await checkedBuffer(new URL(meta.file, baseURL), meta.sha256, controller.signal);
      const parts = decodeMesh(bytes, meta);
      const maps = await Promise.all(parts.map(p => texture(manifest.materials[p.material].texture)));
      if (disposed) throw new Error('Editor closed');
      const group = new THREE.Group();
      for (const [i, part] of parts.entries()) {
        const geometry = new THREE.BufferGeometry();
        const vertices = new THREE.InterleavedBuffer(part.vertices, 12);
        geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(vertices, 3, 0));
        geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(vertices, 3, 3));
        geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(vertices, 2, 6));
        // Native vertex alpha contains shader/wind data, not leaf transparency.
        geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(vertices, 3, 8));
        geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const native = manifest.materials[part.material], blend = native.blend_mode ?? 0;
        const material = new THREE.MeshStandardMaterial({ map: maps[i], vertexColors: true, roughness: .95, metalness: 0,
          alphaTest: native.alpha_test, side: THREE.DoubleSide,
          transparent: blend >= 1 && blend <= 4, depthWrite: native.depth_write ?? true, depthTest: native.depth_test ?? true });
        if (blend >= 2 && blend <= 4) {
          material.blending = THREE.CustomBlending;
          material.blendSrc = blend === 2 ? THREE.SrcAlphaFactor : blend === 3 ? THREE.ZeroFactor : THREE.OneFactor;
          material.blendDst = blend === 3 ? THREE.SrcColorFactor : THREE.OneFactor;
        }
        resources.add(geometry); resources.add(material);
        const object = new THREE.Mesh(geometry, material); object.castShadow = object.receiveShadow = true; object.renderOrder = native.render_order ?? 0; group.add(object);
      }
      return group;
    })();
    models.set(mesh, promise);
    promise.catch(() => models.delete(mesh));
    return promise;
  }
  return {
    async create(asset) {
      const entry = manifest.assets[asset];
      if (!entry) throw new Error('This asset has no 3D model');
      return (await template(entry.mesh)).clone(true);
    },
    dimensions(asset, scale = 1) {
      const box = manifest.meshes[manifest.assets[asset]?.mesh]?.bounds_m;
      return box ? box.max.map((v, i) => (v - box.min[i]) * scale) : null;
    },
    dispose() { disposed = true; controller.abort(); for (const resource of resources) resource.dispose(); resources.clear(); models.clear(); textures.clear(); },
  };
}
