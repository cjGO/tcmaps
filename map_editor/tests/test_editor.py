import argparse
import copy
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import core
import editor
import engine
from helpers import MODULE_ROOT, checksum, split_objects
from rendering import calibrated_heatmap, editor_html
from spawn_variants import entry_record


class EditorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sco = self.root / 'scn_fixture.sco'
        self.recipe_path = self.root / 'scn_fixture.txt'
        self.recipe = 'scn_fixture fixture 256 none none 0 0 100 100 -0.5 0x' + '0'*48 + '\n 0\n 0\n outer_terrain_plain\n'
        self.recipe_path.write_text(self.recipe)
        self.a = dict(team=0, entry=0, x_m=15, y_m=90, z_m=4)
        self.b = dict(team=1, entry=32, x_m=85, y_m=10, z_m=4)
        self.original = struct.pack('<III', 0xfffffd33, 4, 2) + entry_record(self.a, self.b) + entry_record(self.b, self.a) + b'unchanged-terrain-and-ai-tail'
        self.sco.write_bytes(self.original)
        self.source, _ = core.source_identity(self.sco, self.recipe_path)
        self.assets = core.asset_catalogue(MODULE_ROOT / 'scene_props.txt')
        self.bounds = dict(x_min_m=0, x_max_m=100, y_min_m=0, y_max_m=100)
        self.height = dict(map='scn_fixture', grid_size=2, terrain_code=self.source['terrain_code'],
                           bounds=self.bounds, spawn_points=[self.a, self.b],
                           source_sco_sha256=self.source['sco_sha256'], source_recipe_sha256=self.source['recipe_sha256'],
                           samples=[dict(ix=i, iy=j, x_m=x, y_m=y, height_m=4) for i,x in enumerate((1,99)) for j,y in enumerate((1,99))])
        self.height_path = self.root / 'height_data.json'
        core.write_json(self.height_path, self.height)
        self.point = dict(id='point_1', asset='spr_mm_tree_pine1', x_m=20.125, y_m=40.25, yaw_deg=90, scale=1.5)

    def args(self, **kw):
        return argparse.Namespace(sco=self.sco, recipe=self.recipe_path, height_data=self.height_path,
                                  output=self.root/'project', timeout=1, windows_python=Path('unused'), **kw)

    def test_recipe_selection_and_mismatch(self):
        full = self.root / 'scenes.txt'
        full.write_text('scenesfile version 1\n2\n' + self.recipe.replace('scn_fixture fixture', 'scn_other other') + self.recipe)
        self.assertEqual(core.scene_recipe(full, 'scn_fixture'), self.recipe)
        with self.assertRaises(ValueError): core.scene_recipe(full, 'scn_missing')
        with self.assertRaises(ValueError): core.scene_recipe(self.recipe_path, 'scn_other')
        self.recipe_path.write_text(self.recipe.replace(' 256 ', ' 1792 '))
        with self.assertRaises(ValueError): core.source_identity(self.sco, self.recipe_path)

    def test_source_change_rejected(self):
        self.sco.write_bytes(self.original + b'changed')
        with self.assertRaisesRegex(ValueError, 'changed'): core.verify_source(self.source)
        self.sco.write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'Truncated'): core.source_identity(self.sco, self.recipe_path)

    def test_height_provenance_and_grid(self):
        core.verify_height_provenance(self.height_path, self.height, self.source, self.recipe)
        for field,value in [('terrain_code','other'), ('source_sco_sha256','other'), ('grid_size',3)]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                core.verify_height_provenance(self.height_path, dict(self.height, **{field:value}), self.source, self.recipe)
        changed=copy.deepcopy(self.height); changed['samples'][1]['x_m']=3
        with self.assertRaises(ValueError): core.validate_height_data(changed)

    def test_variant_provenance(self):
        data=dict(self.height, source_sco_sha256='baseline')
        core.write_json(self.height_path, data)
        core.write_json(self.root/'variants.json', dict(height_data_sha256=checksum(self.height_path),
            terrain_code=self.source['terrain_code'], variants=[dict(scene_id='scn_fixture', scene_flags=256, sco_sha256=self.source['sco_sha256'])]))
        (self.root/'scenes.txt').write_text('scenesfile version 1\n1\n'+self.recipe)
        self.assertEqual(core.verify_height_provenance(self.height_path,data,self.source,self.recipe), 'pool variant checksums')
        (self.root/'scenes.txt').write_text('scenesfile version 1\n1\n'+self.recipe.replace('outer_terrain_plain','outer_terrain_snow'))
        with self.assertRaises(ValueError):core.verify_height_provenance(self.height_path,data,self.source,self.recipe)

    def test_document_roundtrip_and_bad_placements(self):
        doc=core.placement_document(self.source,[self.point]); path=self.root/'points.json'
        core.write_json(path,doc)
        self.assertEqual(core.validate_placements(core.read_json(path),self.source,self.bounds,self.assets),[self.point])
        for update in [dict(x_m=-1),dict(y_m=101),dict(x_m=1.0001),dict(x_m=True),dict(scale=0),dict(scale=11),
                       dict(yaw_deg=360),dict(yaw_deg=float('nan')),dict(asset='spr_invalid'),dict(id='../x'),dict(z_m=4)]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                core.validate_placements(core.placement_document(self.source,[dict(self.point,**update)]),self.source,self.bounds,self.assets)
        with self.assertRaises(ValueError):core.validate_placements(core.placement_document(self.source,[self.point,self.point]),self.source,self.bounds,self.assets)
        with self.assertRaises(ValueError):core.validate_placements(dict(doc,source={}),self.source,self.bounds,self.assets)
        path.write_text('{"value": NaN}')
        with self.assertRaises(ValueError):core.read_json(path)

    def test_scene_preservation_and_determinism(self):
        assets=core.native_flora_assets(self.assets,MODULE_ROOT/'Data/flora_kinds.txt')
        edited=core.append_vegetation(self.original,[self.point],[12.125],assets)
        objects,tail=split_objects(edited); old,old_tail=split_objects(self.original)
        self.assertEqual(objects[:2],old); self.assertEqual(tail,old_tail)
        raw=objects[2][2]; n=struct.unpack_from('<I',raw,60)[0]
        self.assertEqual(raw[64:64+n],b'mm_pine_copy')
        self.assertEqual(struct.unpack_from('<3f',raw,48),(20.125,40.25,12.125))
        self.assertAlmostEqual(struct.unpack_from('<f',raw,24)[0],-1)
        self.assertEqual(struct.unpack_from('<3f',raw,72+n),(1.5,1.5,1.5))
        self.assertEqual(edited,core.append_vegetation(self.original,[self.point],[12.125],assets))
        self.assertEqual(self.original,core.append_vegetation(self.original,[],[],assets))
        self.assertEqual(self.sco.read_bytes(),self.original)
        with self.assertRaises(ValueError):core.append_vegetation(self.original,[self.point],[],assets)

    def test_native_palm_records_keep_tree_flag_and_exact_variant(self):
        assets=core.native_flora_assets(self.assets,MODULE_ROOT/'Data/flora_kinds.txt')
        for i in range(1,7):
            a=next(a for a in assets if a['name']==f'spr_mm_tree_palm{i}')
            self.assertEqual((a['object_kind'],a['object_id'],a['object_name'],a['variant']),
                             (4,46,'mm_palm_tree',i-1))
            self.assertTrue(a['flora_flags'] & 0x400000)
            raw=core.vegetation_record(a,dict(self.point,asset=a['name']),12.125)
            self.assertEqual(struct.unpack_from('<II',raw),(4,46))
            n=struct.unpack_from('<I',raw,60)[0]
            self.assertEqual(struct.unpack_from('<II',raw,64+n),(i-1,0))
        with self.assertRaisesRegex(ValueError,'No matching native flora'):
            core.native_flora_assets([dict(self.assets[0],mesh='missing_mesh')],MODULE_ROOT/'Data/flora_kinds.txt')
        bad=self.root/'flora.txt';bad.write_text('1\npalm 4194304 1\nmesh body\n')
        with self.assertRaisesRegex(ValueError,'Invalid flora'):
            core.native_flora_assets(self.assets,bad)

    def test_changed_flora_definitions_rejected(self):
        folder=editor.prepare(self.args())
        path=folder/'project.json';p=core.read_json(path)
        p['flora_catalogue_sha256']='changed';core.write_json(path,p)
        with self.assertRaisesRegex(ValueError,'flora definitions changed'):editor.load_project(folder)

    def test_calibration_and_embedded_html(self):
        data=dict(self.height,heatmap_reference_span_m=975)
        calibration=calibrated_heatmap(data,self.root/'map.png')
        self.assertEqual(calibration['width_px'],1600)
        rect=calibration['plot_rect']
        self.assertTrue(0<rect['left']<rect['left']+rect['width']<1)
        self.assertTrue(0<rect['top']<rect['top']+rect['height']<1)
        self.assertAlmostEqual(calibration['x_limits'][1]-calibration['x_limits'][0],975*1.05)
        html=editor_html(dict(source={'scene_id':'</script>'}),self.root/'map.png')
        self.assertIn('data:image/png;base64,',html)
        self.assertIn('\\u003c/script>',html)
        self.assertNotIn('__EDITOR_DATA__',html)

    def test_prepare_uses_saved_measurements_and_refuses_overwrite(self):
        with patch('editor.probe',side_effect=AssertionError('unexpected engine run')):
            folder=editor.prepare(self.args())
        self.assertTrue((folder/'editor.html').is_file())
        editor.load_project(folder)
        with self.assertRaises(FileExistsError):editor.prepare(self.args())
        (folder/'inputs/source.sco').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'snapshot'):editor.load_project(folder)

    def test_probe_failure_leaves_no_ready_project(self):
        args=self.args();args.height_data=None
        with patch('editor.probe',side_effect=ValueError('probe failed')), self.assertRaises(ValueError):editor.prepare(args)
        self.assertFalse((args.output/'project.json').exists())
        self.assertEqual(self.sco.read_bytes(),self.original)

    def test_prepare_changed_assets_and_heights_rejected(self):
        folder=editor.prepare(self.args())
        path=folder/'project.json'; p=core.read_json(path);p['assets'][0]['ground_offset_m']=1;core.write_json(path,p)
        with self.assertRaisesRegex(ValueError,'asset definitions'):editor.load_project(folder)
        p['assets']=self.assets;core.write_json(path,p)
        (folder/'height_data.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'measurements changed'):editor.load_project(folder)

    def test_build_failed_probe_publishes_no_scene(self):
        folder=editor.prepare(self.args())
        placements=folder/'points.json';core.write_json(placements,core.placement_document(self.source,[self.point]))
        args=argparse.Namespace(project=folder,placements=placements,output=folder/'build',timeout=1,windows_python=Path('unused'))
        with patch('editor.probe',side_effect=ValueError('failed')),self.assertRaises(ValueError):editor.build(args)
        self.assertFalse((args.output/'manifest.json').exists())
        self.assertFalse((args.output/'scn_fixture.sco').exists())
        self.assertEqual(self.sco.read_bytes(),self.original)

    def test_complete_build_and_repeat_have_identical_scos(self):
        folder=editor.prepare(self.args())
        placements=folder/'points.json';core.write_json(placements,core.placement_document(self.source,[self.point]))
        logs=self.root/'replay';logs.mkdir()
        (logs/'spawn_points.csv').write_text('0,0,15000,90000,4000\n1,32,85000,10000,4000\n')
        built=[]
        for i in range(2):
            args=argparse.Namespace(project=folder,placements=placements,output=folder/f'build{i}',timeout=1,windows_python=Path('unused'))
            with patch('editor.probe',return_value=(self.bounds,self.height['samples'],[12.125],logs)), \
                 patch('editor.replay_objects',return_value=(self.bounds,self.height['samples'],logs)):
                out=editor.build(args)
            built.append((out/'scn_fixture.sco').read_bytes())
            self.assertTrue((out/'manifest.json').is_file()); self.assertFalse((out/'_staging').exists())
        self.assertEqual(built[0],built[1]); self.assertEqual(self.sco.read_bytes(),self.original)

    def test_biome_build_remeasures_grid_and_grounds_on_final_terrain(self):
        from environment import DEFAULTS
        self.height.update(grid_size=3,samples=[dict(ix=i,iy=j,x_m=x,y_m=y,height_m=4)
            for i,x in enumerate((1,50,99)) for j,y in enumerate((1,50,99))])
        core.write_json(self.height_path,self.height)
        folder=editor.prepare(self.args())
        settings=dict(DEFAULTS,biome='snow_forest',fog='medium',precipitation='snow',thunder='lightning')
        doc=core.placement_document(self.source,[self.point],settings)
        placements=folder/'points.json';core.write_json(placements,doc)
        logs=self.root/'replay';logs.mkdir()
        (logs/'spawn_points.csv').write_text('0,0,15000,90000,4000\n1,32,85000,10000,4000\n')
        changed=[dict(s,height_m=30) for s in self.height['samples']]
        args=argparse.Namespace(project=folder,placements=placements,output=folder/'changed',timeout=1,windows_python=Path('unused'))
        with patch('editor.probe',return_value=(self.bounds,changed,[30],logs)) as ground, \
             patch('editor.replay_objects',return_value=(self.bounds,[changed[i] for i in (0,2,6,8)],logs)) as replay:
            out=editor.build(args)
        self.assertEqual(ground.call_args.args[3],3)
        self.assertEqual(len(replay.call_args.kwargs['weather']),3)
        manifest=core.read_json(out/'manifest.json')
        self.assertTrue(manifest['terrain_remeasured'])
        self.assertEqual(manifest['settings'],settings)
        self.assertEqual(core.read_json(out/'placements.json'),doc)
        self.assertEqual(core.read_json(out/'height_data.json')['samples'],changed)
        objs,tail=split_objects((out/'scn_fixture.sco').read_bytes())
        self.assertEqual(struct.unpack_from('<3f',objs[-1][2],48),(self.point['x_m'],self.point['y_m'],30))
        self.assertEqual([o[2] for o in objs[:2]],[o[2] for o in split_objects(self.original)[0]])
        self.assertEqual(self.sco.read_bytes(),self.original)

    def test_engine_height_coordinates_are_checked(self):
        logs=self.root/'probe';folder=logs/self.source['scene_id'];folder.mkdir(parents=True)
        (folder/'samples.csv').write_text('bounds,0,0,100000,100000\n0,0,1000,1000,1000000,996000\n0,1,1000,99000,1000000,996000\n1,0,99000,1000,1000000,996000\n1,1,99000,99000,1000000,996000\n')
        (folder/'extra_heights.csv').write_text('0,20125,40250,12125\n')
        with patch('engine.run_engine_probe',return_value={self.source['scene_id']:{'ok':True}}):
            self.assertEqual(engine.probe(self.source,self.recipe,logs,2,1,Path('unused'),[self.point])[2],[12.125])
            (folder/'extra_heights.csv').write_text('0,20126,40250,12125\n')
            with self.assertRaisesRegex(ValueError,'different placement'):engine.probe(self.source,self.recipe,logs,2,1,Path('unused'),[self.point])
        with patch('engine.run_engine_probe',return_value={self.source['scene_id']:{'ok':False}}),self.assertRaises(ValueError):
            engine.probe(self.source,self.recipe,logs,2,1,Path('unused'),[self.point])

    def test_terrain_replay_mismatch(self):
        engine.verify_replay(self.height,self.bounds,self.height['samples'])
        changed=copy.deepcopy(self.height['samples']);changed[0]['height_m']=5
        with self.assertRaises(ValueError):engine.verify_replay(self.height,self.bounds,changed)


if __name__ == '__main__':
    unittest.main()
