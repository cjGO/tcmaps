-- Appended to the existing isolated height probe; never installed in the module.
local expected_objects = {
-- EXPECTED_OBJECTS
}
local expected_weather = {
-- EXPECTED_WEATHER
}
local terrain_callback = map_saving_mission_started
local checked_objects = false
local function check_objects_then_terrain()
  if checked_objects then return end
  checked_objects = true
  local previous_reg = game.reg[0]
  local ok, err = pcall(function()
    game.set_fixed_point_multiplier(1000)
    for _, weather in ipairs(expected_weather) do
      assert(game.scene_prop_get_num_instances(0, weather.prop) == 1, 'Weather override missing or duplicated')
      local success, instance = game.scene_prop_get_instance(0, weather.prop, 0)
      assert(success and type(instance) == 'number', 'Cannot read weather instance')
      assert(game.prop_instance_get_variation_id(0, instance) == weather.first and
             game.prop_instance_get_variation_id_2(0, instance) == weather.second, 'Weather override mismatch')
    end
    local consumed = {}
    local lines = {}
    for _, expected in ipairs(expected_objects) do
      local instances = {}
      -- WSE2 iterator meta types are one-based; SCO record kinds are zero-based.
      for instance in game.propInstIt(expected.prop, expected.kind + 1) do
        instances[#instances + 1] = instance
      end
      local count = #instances
      local found = false
      local mismatch = 'Vegetation missing or position mismatch'
      local observed = {}
      for _, instance in ipairs(instances) do
        if not consumed[instance] then
          game.prop_instance_get_position(15, instance)
          local x = game.position_get_x(0, 15)
          local y = game.position_get_y(0, 15)
          local z = game.position_get_z(0, 15)
          observed[#observed + 1] = string.format('%d:%d,%d,%d', instance, x, y, z)
          if math.abs(x - expected.x) <= 2 and math.abs(y - expected.y) <= 2 and math.abs(z - expected.z) <= 2 then
            game.prop_instance_get_scale(16, instance)
            local sx = game.position_get_scale_x(0, 16)
            local sy = game.position_get_scale_y(0, 16)
            local sz = game.position_get_scale_z(0, 16)
            local scale_matches = math.abs(sx - expected.scale) <= 2 and math.abs(sy - expected.scale) <= 2 and math.abs(sz - expected.scale) <= 2
            game.position_move_y(15, 1000, 0)
            local dx = game.position_get_x(0, 15) - x
            local dy = game.position_get_y(0, 15) - y
            local angle = expected.yaw * math.pi / 180
            local length = math.sqrt(dx * dx + dy * dy)
            local rotation_matches = length > 0 and (dx * -math.sin(angle) + dy * math.cos(angle)) / length > 0.999
            local variant_matches = game.prop_instance_get_variation_id(0, instance) == expected.variant
            if scale_matches and rotation_matches and variant_matches then
              consumed[instance] = true
              found = true
              lines[#lines + 1] = string.format('%d,%d,%d,%d,%d,%d,%d,%d', expected.index, instance, x, y, z, sx, sy, sz)
              break
            end
            mismatch = not variant_matches and 'Vegetation variant mismatch' or (scale_matches and 'Vegetation rotation mismatch' or 'Vegetation scale mismatch')
          end
        end
      end
      assert(found, mismatch .. ' at placement ' .. expected.index .. '; count=' .. count .. '; observed=' .. table.concat(observed, ';'))
    end
    -- The shared worker preserves this file. With no extra point requests,
    -- the base height callback leaves it untouched.
    local report = assert(io.open('extra_heights.csv', 'w'))
    assert(report:write(table.concat(lines, '\n') .. (#lines > 0 and '\n' or '')))
    assert(report:close())
  end)
  pcall(function() game.set_fixed_point_multiplier(100) end)
  game.reg[0] = previous_reg
  if not ok then
    local f = assert(io.open('height_error.txt', 'w'))
    f:write(tostring(err)); f:close()
    return
  end
  terrain_callback()
end
map_saving_mission_started = check_objects_then_terrain
mapSavingMissionStarted = check_objects_then_terrain
_G['map saving mission started'] = check_objects_then_terrain
