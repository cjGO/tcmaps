-- Isolated analysis module only: never load production map randomization.
local names = {
  'initialize_map_saving', 'prepare_generated_map', 'prepare_generated_rotation',
  'announce_generated_map_round', 'send_global_chat_message', 'comms_bugreport_help',
  'statistics_boundary', 'statistics_control', 'statistics_join', 'statistics_kill',
  'statistics_leave', 'statistics_mission', 'statistics_owner', 'statistics_round_begin',
  'statistics_round_end', 'statistics_spawn', 'statistics_team', 'statistics_tick',
  'pu_disable_rotation_mode', 'replay_context',
}
local function expose(name, callback)
  _G[name] = callback
  _G[string.gsub(name, '_([a-z])', string.upper)] = callback
  _G[string.gsub(name, '_', ' ')] = callback
end
for _, name in ipairs(names) do expose(name, function() end) end

local grid_size = HEIGHT_GRID_SIZE or 23
local sampled = false
expose('map_saving_mission_started', function()
  if sampled then return end
  sampled = true
  local previous_reg = game.reg[0]
  local ok, err = pcall(function()
    game.set_fixed_point_multiplier(1000)
    game.get_scene_boundaries(10, 11)
    local xmin = game.position_get_x(0, 10)
    local ymin = game.position_get_y(0, 10)
    local xmax = game.position_get_x(0, 11)
    local ymax = game.position_get_y(0, 11)
    assert(xmax - xmin > 2000 and ymax - ymin > 2000, 'Invalid scene bounds')
    local lines = {string.format('bounds,%d,%d,%d,%d', xmin, ymin, xmax, ymax)}
    -- Store raw fixed-point distances as well as coordinates for auditing.
    for ix = 0, grid_size - 1 do
      local x = math.floor(xmin + 1000 + ix * (xmax - xmin - 2000) / (grid_size - 1) + 0.5)
      for iy = 0, grid_size - 1 do
        local y = math.floor(ymin + 1000 + iy * (ymax - ymin - 2000) / (grid_size - 1) + 0.5)
        game.init_position(12)
        game.position_set_x(12, x)
        game.position_set_y(12, y)
        game.position_set_z(12, 1000000)
        local distance = game.position_get_distance_to_terrain(0, 12)
        assert(type(distance) == 'number', 'Terrain query did not return a number')
        lines[#lines + 1] = string.format('%d,%d,%d,%d,%d,%d', ix, iy, x, y, 1000000, distance)
      end
    end
    -- Commander Battle team 0/1 use initial entries 0/32 respectively.
    -- Query the engine because saved random maps auto-generate these positions.
    local spawn_file = assert(io.open('spawn_points.csv', 'w'))
    local facing_file = assert(io.open('spawn_facing.csv', 'w'))
    for team, entry in ipairs({0, 32}) do
      game.entry_point_get_position(13, entry)
      local x = game.position_get_x(0, 13)
      local y = game.position_get_y(0, 13)
      local z = game.position_get_z(0, 13)
      assert(spawn_file:write(string.format('%d,%d,%d,%d,%d\n', team - 1, entry, x, y, z)))
      game.position_move_y(13, 1000, 0)
      local dx = game.position_get_x(0, 13) - x
      local dy = game.position_get_y(0, 13) - y
      assert(facing_file:write(string.format('%d,%d,%d,%d\n', team - 1, entry, dx, dy)))
    end
    assert(spawn_file:close())
    assert(facing_file:close())
    local have_extra, extra_points = pcall(dofile, 'probe_points.lua')
    if have_extra and #extra_points > 0 then
      local extra_file = assert(io.open('extra_heights.csv', 'w'))
      for _, point in ipairs(extra_points) do
        local x = point.x or math.floor(xmin + point.u * (xmax - xmin) + 0.5)
        local y = point.y or math.floor(ymin + point.v * (ymax - ymin) + 0.5)
        game.init_position(14)
        game.position_set_x(14, x)
        game.position_set_y(14, y)
        game.position_set_z(14, 1000000)
        local distance = game.position_get_distance_to_terrain(0, 14)
        assert(extra_file:write(string.format('%d,%d,%d,%d\n',
          point.index, x, y, 1000000 - distance)))
      end
      assert(extra_file:close())
    end
    local f = assert(io.open('height_samples.csv.tmp', 'w'))
    assert(f:write(table.concat(lines, '\n') .. '\n'))
    assert(f:close())
    assert(os.rename('height_samples.csv.tmp', 'height_samples.csv'))
    print('[HeightProbe] complete: ' .. tostring(grid_size * grid_size) .. ' samples')
  end)
  pcall(function() game.set_fixed_point_multiplier(100) end)
  game.reg[0] = previous_reg
  if not ok then
    local f = io.open('height_error.txt', 'w')
    if f then f:write(tostring(err)); f:close() end
    print('[HeightProbe] ERROR: ' .. tostring(err))
  end
end)

-- Appended to the existing isolated height probe; never installed in the module.
local expected_objects = {
{index=0, prop=500, kind=0, variant=0, x=112800, y=524800, z=5879, scale=1000, yaw=30.000000000}
}
local expected_weather = {

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
      local mismatch = 'Map asset missing or position mismatch'
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
            mismatch = not variant_matches and 'Map asset variant mismatch' or (scale_matches and 'Map asset rotation mismatch' or 'Map asset scale mismatch')
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
