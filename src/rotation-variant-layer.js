import * as THREE from 'three';
import models from '../lib/editor-models.json';
import { checkedBuffer, createModelLibrary } from './editor-model-loader.js';
import { groundHeight, placementTransform } from './editor-spatial.js';
import { displayedHeight } from './terrain-geometry.js';
import { assertVariantSource } from './map-variants.js';

export function createVariantLayer(viewer, data, document) {
  const controller = new AbortController(), group = new THREE.Group();
  let library, disposed = false;
  const records = [];
  const update = scale => {
    for (const { object, transform } of records) {
      object.position.set(transform.position[0], transform.position[1], displayedHeight(transform.position[2], data.min_height_m, scale));
      object.scale.set(transform.scale, transform.scale, transform.scale * scale);
    }
  };
  viewer.addLayer(group);
  const unsubscribe = viewer.onHeightChange(update);
  const ready = (async () => {
    assertVariantSource(document, data);
    const url = new URL(import.meta.env.BASE_URL + models.manifest_url.replace(/^\//, ''), location.href);
    const bytes = await checkedBuffer(url, models.manifest_sha256, controller.signal);
    if (disposed) return;
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    library = createModelLibrary(manifest, url);
    await Promise.all(document.placements.map(async point => {
      const transform = placementTransform(data, point, manifest.assets[point.asset] || {});
      const object = await library.create(point.asset);
      if (disposed) return;
      object.rotation.z = transform.yaw;
      records.push({ object, transform }); group.add(object);
    }));
    if (disposed) return;
    update(viewer.heightScale);
    if (document.spawn_points?.length === 2) viewer.updateSpawns(document.spawn_points.map(p => ({ ...p, z_m: groundHeight(data, p.x_m, p.y_m) })));
    viewer.draw();
  })();
  return { ready, dispose() { disposed = true; controller.abort(); unsubscribe(); group.removeFromParent(); library?.dispose(); } };
}
