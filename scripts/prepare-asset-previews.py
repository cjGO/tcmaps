#!/usr/bin/env python3
"""Render the editor's installed vegetation meshes into static sidebar previews.

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
import struct

import numpy as np
from PIL import Image
import moderngl

ROOT = Path(__file__).resolve().parents[1]


class Reader:
    def __init__(self, path):
        self.data = path.read_bytes()
        self.offset = 0
        self.version = 0

    def take(self, size):
        end = self.offset + size
        if end > len(self.data):
            raise ValueError('Truncated BRF')
        result = self.data[self.offset:end]
        self.offset = end
        return result

    def uint(self):
        return struct.unpack('<I', self.take(4))[0]

    def string(self):
        size = self.uint()
        if size > 255:
            raise ValueError('Invalid BRF string')
        return self.take(size).decode('ascii')

    def array(self, dtype, width):
        count = self.uint()
        return np.frombuffer(self.take(count * np.dtype(dtype).itemsize * width),
                             dtype=dtype).reshape(count, width)

    def mesh(self):
        name, flags, material = self.string(), self.uint(), self.string()
        version = (1 if flags & (1 << 16) else 2) if self.version else 0
        positions = self.array('<f4', 3)
        for _ in range(self.uint()):  # skinning groups
            self.uint()
            self.take(self.uint() * 8)
        for _ in range(self.uint()):  # extra animation frames
            self.uint()
            self.array('<f4', 3)
            self.array('<f4', 3)
        vertex_type = np.dtype([('index', '<u4'), ('color', 'u1', 4),
                                ('normal', '<f4', 3),
                                ('tangent', 'u1', 13 if version == 1 else 0),
                                ('uv', '<f4', 2),
                                ('uv2', 'u1', 8 if version == 0 else 0)])
        vertices = np.frombuffer(self.take(self.uint() * vertex_type.itemsize), dtype=vertex_type)
        faces = self.array('<u4', 3)
        if len(vertices) and (vertices['index'].max() >= len(positions) or faces.max() >= len(vertices)):
            raise ValueError('Invalid mesh indices: ' + name)
        return dict(name=name, material=material, positions=positions[vertices['index']],
                    normals=vertices['normal'], colors=vertices['color'] / 255.0,
                    uv=vertices['uv'], faces=faces)

    def material(self):
        name, flags = self.string(), self.uint()
        shader, diffuse = self.string(), self.string()
        for _ in range(3):
            self.string()
        size = struct.unpack_from('<I', self.data, self.offset)[0]
        if 0 < size < 99:  # older material records omit the specular texture
            self.string()
        specular, r, g, b = struct.unpack('<4f', self.take(16))
        return name, dict(flags=flags, diffuse=diffuse, shader=shader)


def read_brf(path):
    reader = Reader(path)
    meshes, materials = {}, {}
    while True:
        section = reader.string()
        if section == 'end':
            break
        if section == 'rfver ':
            reader.version = reader.uint()
            if reader.version != 1:
                raise ValueError('Unsupported BRF version: ' + str(path))
            continue
        if section not in ('mesh', 'material', 'texture'):
            # Collision bodies, skeletons and shaders are not preview inputs.
            break
        for _ in range(reader.uint()):
            if section == 'mesh':
                mesh = reader.mesh()
                meshes[mesh['name']] = mesh
            elif section == 'material':
                name, material = reader.material()
                materials[name] = material
            else:
                reader.string()
                reader.uint()
    return meshes, materials


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/editor-assets')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'lib/editor-asset-previews.json')
    args = parser.parse_args()
    module = args.module_root.resolve()
    projects = [json.loads(path.read_text()) for path in (ROOT / 'public/editor').glob('*/*/project.json')]
    assets = {a['name']: a for project in projects for a in project['assets']}
    if not assets:
        raise ValueError('No published editor assets')
    meshes, materials = {}, {}
    inputs = {}
    # The installed module overrides native resources; use its own copies.
    for name in ('materials', 'mmmaterials', 'mm_confederate_materials', 'tree_meshes',
                 'town_houses_d', 'tree_f', 'mmplants', 'terrain_borders', 'mm_confederate_uniforms'):
        path = module / 'Resource' / (name + '.brf')
        found_meshes, found_materials = read_brf(path)
        meshes.update(found_meshes)
        materials.update(found_materials)
        inputs[str(path.relative_to(module))] = hashlib.sha256(path.read_bytes()).hexdigest()
    textures = {p.name.lower(): p for folder in (module.parent.parent / 'Textures', module / 'Textures')
                if folder.exists() for p in folder.iterdir() if p.is_file()}
    os.environ.setdefault('MESA_SHADER_CACHE_DIR', '/tmp/rate-maps-mesa-cache')
    context = moderngl.create_standalone_context(backend='egl')
    program = context.program(vertex_shader='''
        #version 330
        in vec3 position; in vec3 normal; in vec2 uv; in vec4 color;
        out vec2 texcoord; out vec3 lighting;
        void main() {
            gl_Position = vec4(position, 1.0); texcoord = uv;
            float light = 0.72 + 0.28 * abs(dot(normalize(normal), normalize(vec3(-1,-2,3))));
            lighting = color.rgb * light;
        }
    ''', fragment_shader='''
        #version 330
        uniform sampler2D diffuse; uniform float cutoff;
        in vec2 texcoord; in vec3 lighting; out vec4 result;
        void main() {
            vec4 pixel = texture(diffuse, texcoord);
            if (pixel.a < cutoff) discard;
            result = vec4(pixel.rgb * lighting, 1.0);
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
        framebuffer.clear(0.93, 0.95, 0.92, 1.0)
        for part in parts:
            material = materials[part['material']]
            texture_name = material['diffuse']
            filename = texture_name if Path(texture_name).suffix else texture_name + '.dds'
            path = textures[filename.lower()]
            if path not in texture_cache:
                with Image.open(path) as source:
                    image = source.convert('RGBA')
                texture = context.texture(image.size, 4, image.tobytes())
                texture.build_mipmaps()
                texture_cache[path] = texture
                inputs[str(path.relative_to(module)) if path.is_relative_to(module) else 'game/Textures/' + path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            texture_cache[path].use()
            flags = material['flags']
            program['cutoff'] = {0: 0, 1: 8 / 256, 2: 136 / 256, 3: 251 / 256}[(flags >> 12) & 3]
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
    args.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Generated {len(manifest['assets'])} asset previews from {len(texture_cache)} textures.")


if __name__ == '__main__':
    main()
