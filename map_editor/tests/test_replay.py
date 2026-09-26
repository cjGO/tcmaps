"""Regression coverage for native flora enumeration, variants and transforms."""
from pathlib import Path
import unittest

try:
    from lupa import LuaRuntime
except ImportError:
    LuaRuntime = None


@unittest.skipIf(LuaRuntime is None, 'Optional Lua tests require uv --with lupa')
class ReplayTests(unittest.TestCase):
    def run_replay(self, change='', weather=''):
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.execute('''
          files = {}; terrain_called = false
          io.open = function(path, mode)
            local f = {}
            function f:write(text) files[path] = (files[path] or '') .. text; return true end
            function f:close() return true end
            return f
          end
          game = {reg={[0]=999}, objects={
            [101]={prop=11,x=20000,y=30000,z=4000,scale=1000},
            [202]={prop=22,x=25000,y=35000,z=5000,scale=1400}
          },positions={}}
          game.set_fixed_point_multiplier = function(n) game.multiplier=n end
          game.propInstIt = function(prop,kind)
            assert(kind==5, 'WSE2 flora iterator type must be five')
            local id=0
            return function()
              while true do
                id=id+1
                if id>303 then return nil end
                if game.objects[id] and game.objects[id].prop==prop then return id end
              end
            end
          end
          game.prop_instance_get_variation_id = function(_,id) return game.objects[id].variant or 0 end
          game.prop_instance_get_position = function(pos,id)
            assert(type(id)=='number' and game.objects[id], 'wrong instance result')
            local object=game.objects[id]
            game.positions[pos]={x=object.x,y=object.y,z=object.z}
          end
          game.prop_instance_get_scale = function(pos,id) game.positions[pos]={scale=game.objects[id].scale} end
          game.position_get_x = function(_,pos) return game.positions[pos].x or 0 end
          game.position_get_y = function(_,pos) return game.positions[pos].y or 0 end
          game.position_get_z = function(_,pos) return game.positions[pos].z or 0 end
          game.position_get_scale_x = function(_,pos) return game.positions[pos].scale end
          game.position_get_scale_y = game.position_get_scale_x
          game.position_get_scale_z = game.position_get_scale_x
          game.position_move_y = function(pos,distance,_) game.positions[pos].y=game.positions[pos].y+distance end
          map_saving_mission_started = function() terrain_called=true end
        ''')
        lua.execute(change)
        source=(Path(__file__).resolve().parents[1]/'replay.lua').read_text()
        source=source.replace('-- EXPECTED_OBJECTS', '''
          {index=0,prop=11,kind=4,variant=0,x=20000,y=30000,z=4000,scale=1000,yaw=0},
          {index=1,prop=22,kind=4,variant=0,x=25000,y=35000,z=5000,scale=1400,yaw=0}
        ''')
        source=source.replace('-- EXPECTED_WEATHER',weather)
        lua.execute(source)
        lua.eval('map_saving_mission_started')()
        return lua

    def test_both_assets_verified_using_returned_instances_and_matrix_scales(self):
        lua=self.run_replay()
        self.assertTrue(lua.globals().terrain_called)
        self.assertIn('0,101,20000,30000,4000,1000,1000,1000',lua.globals().files['extra_heights.csv'])
        self.assertIn('1,202,25000,35000,5000,1400,1400,1400',lua.globals().files['extra_heights.csv'])
        self.assertIsNone(lua.globals().files['height_error.txt'])
        self.assertEqual(lua.globals().game.reg[0],999)
        self.assertEqual(lua.globals().game.multiplier,100)

    def test_existing_object_at_same_position_does_not_hide_matching_addition(self):
        lua=self.run_replay("""
          game.objects[102]={prop=22,x=25000,y=35000,z=5000,scale=800}
        """.replace('+',''))
        self.assertTrue(lua.globals().terrain_called)
        self.assertIn('1,202,',lua.globals().files['extra_heights.csv'])

    def test_wrong_native_variant_stops_completion(self):
        lua=self.run_replay('game.objects[202].variant=1')
        self.assertFalse(lua.globals().terrain_called)
        self.assertIn('variant mismatch',lua.globals().files['height_error.txt'])

    def test_missing_native_flora_stops_completion(self):
        lua=self.run_replay('game.objects[202]=nil')
        self.assertFalse(lua.globals().terrain_called)
        self.assertIn('Vegetation missing',lua.globals().files['height_error.txt'])

    def test_weather_override_variations_are_verified(self):
        stub = """
          game.scene_prop_get_num_instances=function(_,prop) return 1 end
          game.scene_prop_get_instance=function(_,prop,index) return true,909,0 end
          local flora_variant=game.prop_instance_get_variation_id
          game.prop_instance_get_variation_id=function(_,id) return id==909 and 45 or flora_variant(_,id) end
          game.prop_instance_get_variation_id_2=function(_,id) return 0 end
        """
        weather='{prop=506, first=45, second=0}'
        self.assertTrue(self.run_replay(stub,weather).globals().terrain_called)
        failed=self.run_replay(stub+'game.prop_instance_get_variation_id_2=function() return 1 end',weather)
        self.assertFalse(failed.globals().terrain_called)
        self.assertIn('Weather override mismatch',failed.globals().files['height_error.txt'])
        duplicate=self.run_replay(stub+'game.scene_prop_get_num_instances=function() return 2 end',weather)
        self.assertFalse(duplicate.globals().terrain_called)
        self.assertIn('duplicated',duplicate.globals().files['height_error.txt'])

    def test_wrong_height_stops_completion(self):
        lua=self.run_replay('game.objects[202].z=6000')
        self.assertFalse(lua.globals().terrain_called)
        self.assertIn('position mismatch',lua.globals().files['height_error.txt'])

    def test_wrong_scale_stops_completion(self):
        lua=self.run_replay('game.objects[202].scale=1000')
        self.assertFalse(lua.globals().terrain_called)
        self.assertIn('scale mismatch',lua.globals().files['height_error.txt'])

    def test_wrong_rotation_stops_completion(self):
        lua=self.run_replay('game.position_move_y=function(pos,distance,_) game.positions[pos].x=game.positions[pos].x+distance end')
        self.assertFalse(lua.globals().terrain_called)
        self.assertIn('rotation mismatch',lua.globals().files['height_error.txt'])


if __name__ == '__main__':
    unittest.main()
