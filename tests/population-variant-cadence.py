"""Run with uv run --with lupa python tests/population-variant-cadence.py."""
from pathlib import Path
import unittest
import sys
from lupa.lua51 import LuaRuntime

SOURCE = (Path(__file__).resolve().parents[1] / 'server/bigmap/lua/population_rotation.lua').read_text()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/bigmap/lua'))
from population_rotation_data import validate_manifest, lua_data, MICRO_GENERATORS

class ManifestTests(unittest.TestCase):
    def manifest(self):
        return dict(schema_version=4, micro_max_players=6, tiny_max_players=20,
                    installed_only_pools=['medium'], variant_every=4,
                    variant_pool=['mp_custom_map_2','mp_custom_map_4','mp_custom_map_6'],
                    pools=dict(micro=list(MICRO_GENERATORS), tiny=['mp_custom_map_1','mp_custom_map_2'],
                               small=['mp_custom_map_3','mp_custom_map_4'],medium=['mp_custom_map_5','mp_custom_map_6']))

    def test_generated_data_contains_all_sizes_and_cadence(self):
        data=self.manifest();order=validate_manifest(data)
        ids={slot:i for i,slot in enumerate(order)}
        generated=LuaRuntime().execute(lua_data(data,ids).decode())
        self.assertEqual(generated.variant_every,4)
        self.assertEqual(list(generated.variant_pool.values()),[ids[s] for s in data['variant_pool']])
        self.assertEqual(list(generated.bigmap_pool.values()),[ids[s] for s in data['pools']['medium']])

    def test_rejects_empty_duplicate_unregistered_and_wrong_interval(self):
        for patch in ({'variant_pool':[]}, {'variant_pool':['mp_custom_map_2']*2},
                      {'variant_pool':['mp_custom_map_100']}, {'variant_every':3},
                      {'variant_pool':['mp_custom_map_1','mp_custom_map_2']}):
            data=self.manifest();data.update(patch)
            with self.assertRaises(ValueError):validate_manifest(data)

    def test_legacy_manifest_remains_supported(self):
        data=self.manifest();del data['variant_every'];del data['variant_pool']
        validate_manifest(data)

class CadenceTests(unittest.TestCase):
    def runtime(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.execute('''
          now=100; humans=0; logs={}
          os.time=function() return now end
          io.open=function() return {close=function() end} end
          dofile=function() return {schema_version=4,micro_max_players=6,tiny_max_players=20,
            variant_every=4, variant_pool={302,102,202}, bigmap_pool={201,202},
            pools={micro={401,402,403},tiny={301,302,303},small={101,102,103}}} end
          game={reg={},sreg={},multiplayer_is_server=function() return true end,
            multiplayer_is_dedicated_server=function() return true end,
            get_max_players=function() return 200 end,
            player_is_active=function(p) return p>0 and p<=humans end,
            player_is_admin=function() return true end,
            multiplayer_send_string_to_player=function() end,
            server_add_message_to_log=function(s) logs[#logs+1]=s end}
        ''')
        lua.execute(SOURCE)
        return lua.globals()

    def select(self,g):
        g.population_rotation_select()
        return g.game.reg[0]

    def test_all_populations_and_variant_wrap(self):
        for population in (0,6,7,20,21,100):
            g=self.runtime(); g.humans=population
            g.population_rotation_mission_started(401)
            for position in range(2,33):
                scene=self.select(g)
                if position%4==0:
                    self.assertEqual(scene,(302,102,202)[(position//4-1)%3])
                else:
                    self.assertIn(scene, (401,402,403) if population<=6 else (301,303) if population<=20 else (101,103))
                g.population_rotation_mission_started(scene)
                g.population_rotation_mission_started(scene) # duplicate callback

    def test_population_changes_retry_and_unexpected_start(self):
        g=self.runtime();g.population_rotation_mission_started(401)
        for count in (12,80):
            g.humans=count;g.population_rotation_mission_started(self.select(g))
        self.assertEqual(self.select(g),302)
        self.assertEqual(self.select(g),-1)
        g.now=111;g.humans=0
        self.assertEqual(self.select(g),302)
        g.population_rotation_mission_started(999)
        self.assertEqual(self.select(g),302)
        g.population_rotation_mission_started(302)
        self.assertEqual(self.select(g),402)

    def test_size_vote_waits_for_variant(self):
        g=self.runtime();g.humans=10;g.population_rotation_mission_started(401)
        for _ in range(2):g.population_rotation_mission_started(self.select(g))
        g.bigmap_command(1,'/bigmap','true')
        self.assertEqual(self.select(g),302)
        g.population_rotation_mission_started(302)
        self.assertEqual(self.select(g),201)

if __name__=='__main__':unittest.main()
