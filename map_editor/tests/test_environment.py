import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import placement_document, validate_placements
from environment import DEFAULTS, BIOMES, BIOME_MASK, apply_environment, validate_settings
from helpers import MODULE_ROOT, split_objects
from make_weather_variants import weather_prop
from spawn_variants import entry_record


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.recipe = 'scn_fixture fixture 256 none none 0 0 100 100 -0.5 0x000000033000123400000abc000001230000004500000067\n 0\n 0\n outer_terrain_plain\n'
        a=dict(team=0,entry=0,x_m=10,y_m=20,z_m=3)
        b=dict(team=1,entry=32,x_m=90,y_m=80,z_m=4)
        self.records=[entry_record(a,b),weather_prop(503,9),weather_prop(506,80),weather_prop(504,1,6),
                      weather_prop(507,2,70),weather_prop(505,90),weather_prop(506,60)]
        self.original=struct.pack('<III',0xfffffd33,4,len(self.records))+b''.join(self.records)+b'unchanged_terrain_tail'

    def apply(self, **settings):
        return apply_environment(self.original,self.recipe,dict(DEFAULTS,**settings),MODULE_ROOT/'scene_props.txt')

    def test_legacy_and_v2_roundtrip_and_validation(self):
        legacy=placement_document({},[])
        self.assertEqual(validate_settings(legacy),DEFAULTS)
        settings=dict(DEFAULTS,biome='steppe',fog='medium',precipitation='rain',thunder='lightning')
        doc=placement_document({},[],settings)
        self.assertEqual(doc['version'],2)
        self.assertEqual(validate_settings(doc),settings)
        self.assertEqual(validate_placements(doc,{},dict(x_min_m=0,x_max_m=1,y_min_m=0,y_max_m=1),[]),[])
        for update in [dict(biome='steppe_forest'),dict(fog=450),dict(fog='heavy'),dict(precipitation='hail'),
                       dict(precipitation_intensity=True),dict(precipitation_intensity=0),dict(precipitation_intensity=26),
                       dict(thunder=True),dict(thunder_frequency=0),dict(thunder_frequency=101),dict(thunder_frequency=1.5),dict(extra=1)]:
            with self.subTest(update=update),self.assertRaises(ValueError):
                validate_settings(dict(doc,settings=dict(settings,**update)))
        for bad in [dict(legacy,settings=settings),dict(doc,settings={}),dict(doc,version=3),dict(doc,version=True)]:
            with self.assertRaises(ValueError):validate_settings(bad)

    def test_keep_source_is_byte_identical(self):
        sco,recipe,weather=self.apply()
        self.assertEqual((sco,recipe,weather),(self.original,self.recipe,[]))

    def test_fog_levels_replace_duplicates_and_preserve_all_other_records(self):
        for level,distance in [('low',600),('medium',450),('dense',300)]:
            sco,recipe,weather=self.apply(fog=level)
            objects,tail=split_objects(sco)
            self.assertEqual([r for k,p,r in objects if p!=506], [r for k,p,r in split_objects(self.original)[0] if p!=506])
            self.assertEqual(tail,b'unchanged_terrain_tail')
            self.assertEqual(recipe,self.recipe)
            self.assertEqual(weather,[dict(prop=506,first=distance//10,second=0)])
            self.assertEqual([r for k,p,r in objects if p==506],[weather_prop(506,distance//10)])

    def test_seven_biomes_change_only_biome_bits_and_outer_terrain(self):
        before=int(self.recipe.split()[10],16)
        self.assertEqual(set(BIOMES),{'steppe','plains','snow','desert','plains_forest','snow_forest','desert_forest'})
        for biome,(region,outer) in BIOMES.items():
            sco,recipe,_=self.apply(biome=biome)
            after=int(recipe.split()[10],16)
            self.assertEqual(before&~BIOME_MASK,after&~BIOME_MASK)
            self.assertEqual((after&BIOME_MASK)>>156,region)
            self.assertEqual(recipe.splitlines()[3].strip(),outer)
            self.assertEqual(recipe.split()[:10],self.recipe.split()[:10])
            self.assertEqual(sco,self.original)

    def test_precipitation_and_thunder_encode_exact_variations(self):
        for precip,kind in [('clear',0),('rain',1),('snow',2)]:
            for thunder,thunder_kind in [('off',0),('thunder',1),('lightning',2)]:
                sco,_,weather=self.apply(precipitation=precip,precipitation_intensity=25,thunder=thunder,thunder_frequency=100)
                self.assertEqual(weather,[dict(prop=504,first=kind,second=25 if kind else 0),
                                          dict(prop=507,first=thunder_kind,second=100 if thunder_kind else 0)])
                remaining=lambda data:[raw for k,p,raw in split_objects(data)[0] if not(k==0 and p in (504,507))]
                self.assertEqual(remaining(sco),remaining(self.original))
                self.assertEqual(sco,self.apply(precipitation=precip,precipitation_intensity=25,thunder=thunder,thunder_frequency=100)[0])


if __name__=='__main__':unittest.main()
