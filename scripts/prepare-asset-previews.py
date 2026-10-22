#!/usr/bin/env python3
"""Render the editor's installed map asset meshes into static sidebar previews.

Run with: uv run --with numpy --with pillow --with moderngl python
scripts/prepare-asset-previews.py --module-root /path/to/Modules/MOD

Reads game resources only; writes thumbnails into public/editor-assets and a
manifest into lib/editor-asset-previews.json.
BRF layout reference: https://github.com/Swyter/openbrf-redux
(brfMesh.cpp, brfMaterial.cpp and saveLoad.cpp). This is a static model preview,
not a reproduction of the game's lighting, wind or seasonal shaders.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import numpy as np
from PIL import Image
import moderngl

ROOT = Path(__file__).resolve().parents[1]



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/editor-assets')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'lib/editor-asset-previews.json')
    parser.add_argument('--project', type=Path, help='Optional prepared project.json instead of published projects')
    args = parser.parse_args()
    module = args.module_root.resolve()
    projects = ([json.loads(args.project.read_text())] if args.project else
                [json.loads(path.read_text()) for path in (ROOT / 'public/editor').glob('*/*/project.json')])
    assets = {a['name']: a for project in projects for a in project['assets']}
    if not assets:
        raise ValueError('No published editor assets')
    sys.path.insert(0, str(module / 'pythonHelpers'))
    from game_scene_resources import load_resources, texture_paths, material_rendering
    meshes, materials, resource_inputs = load_resources(module, {a['mesh'] for a in assets.values()})
    inputs = {str(path): sha for path, sha in resource_inputs.items()}
    textures = texture_paths(module)
    os.environ.setdefault('MESA_SHADER_CACHE_DIR', '/tmp/rate-maps-mesa-cache')
    context = moderngl.create_standalone_context(backend='egl')
    program = context.program(vertex_shader='''
        #version 330
        in vec3 position; in vec3 normal; in vec2 uv; in vec4 color;
        out vec2 texcoord; out vec3 lighting;
        void main() {
            gl_Position = vec4(position, 1.0); texcoord = vec2(uv.x, 1.0 - uv.y);
            float light = 0.72 + 0.28 * abs(dot(normalize(normal), normalize(vec3(-1,-2,3))));
            lighting = color.rgb * light;
        }
    ''', fragment_shader='''
        #version 330
        uniform sampler2D diffuse; uniform float cutoff; uniform bool blendAlpha;
        in vec2 texcoord; in vec3 lighting; out vec4 result;
        void main() {
            vec4 pixel = texture(diffuse, texcoord);
            if (pixel.a < cutoff) discard;
            result = vec4(pixel.rgb * lighting, blendAlpha ? pixel.a : 1.0);
        }
    ''')
    framebuffer = context.simple_framebuffer((640, 640))
    framebuffer.use()
    context.enable(moderngl.DEPTH_TEST)
    texture_cache = {}
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = dict(version=1, description='Static textured game models at default scale; fitted to preview.',
                    inputs=inputs, assets={})
    direction = np.array([1.0, -2.0, 0.65])
    direction /= np.linalg.norm(direction)
    right = np.cross([0, 0, 1], direction)
    right /= np.linalg.norm(right)
    up = np.cross(direction, right)
    basis = np.array([right, up, -direction]).T
    for mesh_name in sorted({a['mesh'] for a in assets.values()}):
        # Warband multipart meshes use .1, .2, etc.; include every full-detail part.
        parts = [m for name, m in meshes.items() if name == mesh_name or re.fullmatch(re.escape(mesh_name) + r'\.\d+', name)]
        if not parts:
            raise ValueError('Missing mesh: ' + mesh_name)
        projected = np.concatenate([m['positions'] @ basis for m in parts])
        low, high = projected.min(axis=0), projected.max(axis=0)
        center = (low + high) / 2
        span = max((high - low)[:2]) * 1.12
        framebuffer.depth_mask = True
        framebuffer.clear(0.93, 0.95, 0.92, 1.0)
        parts.sort(key=lambda part: (material_rendering(materials[part['material']]['flags'])['blend_mode'] in (1, 2, 3, 4), material_rendering(materials[part['material']]['flags'])['render_order']))
        for part in parts:
            material = materials[part['material']]
            texture_name = material['diffuse']
            filename = texture_name if Path(texture_name).suffix else texture_name + '.dds'
            path = textures[filename.lower()]
            if path not in texture_cache:
                with Image.open(path) as source:
                    image = source.convert('RGBA')
                    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
                texture = context.texture(image.size, 4, image.tobytes())
                texture.build_mipmaps()
                texture_cache[path] = texture
                inputs[str(path.relative_to(module)) if path.is_relative_to(module) else 'game/Textures/' + path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            texture_cache[path].use()
            flags = material['flags']
            rendering = material_rendering(flags)
            blend = rendering['blend_mode']
            program['cutoff'] = rendering['alpha_test']
            program['blendAlpha'] = blend in (1, 2)
            if blend in (1, 2, 3, 4):
                context.enable(moderngl.BLEND)
                context.blend_func = {1: (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA),
                                      2: (moderngl.SRC_ALPHA, moderngl.ONE),
                                      3: (moderngl.ZERO, moderngl.SRC_COLOR),
                                      4: (moderngl.ONE, moderngl.ONE)}[blend]
            else:
                context.disable(moderngl.BLEND)
            framebuffer.depth_mask = rendering['depth_write']
            positions = (part['positions'] @ basis - center) * 2 / span
            positions[:, 2] *= 0.1  # keep the full object within the depth range
            data = np.column_stack((positions, part['normals'], part['uv'], part['colors'])).astype('f4')
            buffer = context.buffer(data.tobytes())
            indices = context.buffer(part['faces'].astype('u4').tobytes())
            vao = context.vertex_array(program, [(buffer, '3f 3f 2f 4f', 'position', 'normal', 'uv', 'color')], indices)
            vao.render()
            vao.release()
            buffer.release()
            indices.release()
        image = Image.frombytes('RGB', framebuffer.size, framebuffer.read()).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        image = image.resize((320, 320), Image.Resampling.LANCZOS)
        image.save(args.output / (mesh_name + '.webp'), quality=86)
        for name, asset in assets.items():
            if asset['mesh'] == mesh_name:
                manifest['assets'][name] = dict(mesh=mesh_name, image=mesh_name + '.webp')
        print('Rendered ' + mesh_name, flush=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Generated {len(manifest['assets'])} asset previews from {len(texture_cache)} textures.")


if __name__ == '__main__':
    main()
