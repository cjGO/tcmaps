"""Check installed rotation discovery without launching the game engine."""
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

registered_maps = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/prepare-editor.py'))['registered_maps']


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_identity(sco, recipe_path):
    recipe = recipe_path.read_text()
    return dict(scene_id=sco.stem, sco_path=str(sco), recipe_path=str(recipe_path),
                sco_sha256=checksum(sco), recipe_sha256=checksum(recipe_path),
                terrain_code=recipe.split()[10]), recipe


class RegisteredEditorMapsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.module = Path(self.temp.name)
        self.custom = self.module / 'custom_maps'
        self.batch = self.custom / 'random_maps/installed_batch'
        self.batch.mkdir(parents=True)
        (self.module / 'SceneObj').mkdir()
        self.recipe = 'scn_mp_custom_map_2 mp_custom_map_2 256 none none 0 0 100 100 -0.5 0x123\n 0\n 0\n outer_terrain_plain\n'
        (self.module / 'scenes.txt').write_text(self.recipe)
        for folder in [self.batch, self.module / 'SceneObj']:
            (folder / 'scn_mp_custom_map_2.sco').write_bytes(b'registered map')
        (self.batch / 'scn_mp_custom_map_2.txt').write_text(self.recipe)
        (self.batch / 'scn_mp_custom_map_2.png').write_bytes(b'registered preview')
        self.pools = dict(tiny=['mp_custom_map_2'], micro=['random_multi_plain_large'])
        self.installed = {'mp_custom_map_2': dict(source='random_maps/installed_batch/scn_mp_custom_map_2.sco',
                                                sha256=checksum(self.batch / 'scn_mp_custom_map_2.sco'), terrain_code='0x123')}

    def discover(self):
        (self.custom / 'population_rotation.json').write_text(json.dumps(dict(pools=self.pools)))
        (self.custom / 'installed_random_maps.json').write_text(json.dumps(self.installed))
        return registered_maps(self.module, source_identity, checksum)

    def test_uses_registered_fixed_maps_and_ignores_unregistered_files(self):
        (self.batch / 'scn_mp_custom_map_99.sco').write_bytes(b'not registered')
        rows = self.discover()
        self.assertEqual([row['id'] for row in rows], ['scn_mp_custom_map_2'])
        self.assertEqual(rows[0]['pool'], 'tiny')
        self.assertIn('/current_rotation/scn_mp_custom_map_2/', rows[0]['project'])
        self.assertEqual(rows[0]['imageSha256'], checksum(self.batch / 'scn_mp_custom_map_2.png'))

    def test_rejects_stale_installed_scene(self):
        (self.module / 'SceneObj/scn_mp_custom_map_2.sco').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'Installed scene differs'):
            self.discover()

    def test_rejects_stale_registered_recipe(self):
        (self.module / 'scenes.txt').write_text(self.recipe.replace('0x123', '0x456'))
        with self.assertRaisesRegex(ValueError, 'Installed scene recipe differs'):
            self.discover()

    def test_rejects_stale_saved_source(self):
        (self.batch / 'scn_mp_custom_map_2.sco').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'registry/source mismatch'):
            self.discover()

    def test_rejects_duplicate_slots(self):
        self.pools['small'] = ['mp_custom_map_2']
        with self.assertRaisesRegex(ValueError, 'Duplicate rotation slot'):
            self.discover()

    def test_rejects_unknown_non_micro_maps(self):
        self.pools['tiny'] = ['unrecognized_map']
        with self.assertRaisesRegex(ValueError, 'Unsupported registered map'):
            self.discover()


if __name__ == '__main__':
    unittest.main()
