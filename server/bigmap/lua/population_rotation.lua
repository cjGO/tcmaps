-- Population is sampled only when an automatic map transition is committed.
-- Cursors advance on the mission-start callback, never on selection/announcement.
local file = io.open('population_rotation_data.lua', 'rb')
local data
if file then file:close(); data = dofile('population_rotation_data.lua') end
local cursors = {micro=1, tiny=1, small=1, medium=1}
local pool_names = data and data.schema_version == 4 and {'micro', 'tiny', 'small'} or data and data.schema_version == 3 and {'micro', 'tiny', 'small', 'medium'} or data and data.schema_version == 2 and {'tiny', 'small', 'medium'} or {'small', 'medium'}
local pending, started = nil, false
if data then
   assert((data.schema_version == 4 and (data.micro_max_players == 5 or data.micro_max_players == 6) and data.tiny_max_players == 20 and data.small_max_players == nil) or
          (data.schema_version == 1 and (data.small_max_players == 22 or data.small_max_players == 14)) or
          (data.schema_version == 2 and data.tiny_max_players == 14 and data.small_max_players == 24) or
          (data.schema_version == 3 and (data.micro_max_players == 6 or data.micro_max_players == 8) and data.tiny_max_players == 18 and data.small_max_players == 25), 'Invalid population rotation schema')
   local seen = {}
   for _, pool in ipairs(pool_names) do
      assert(type(data.pools[pool]) == 'table' and #data.pools[pool] > 0, 'Empty population pool')
      for _, scene in ipairs(data.pools[pool]) do
         assert(type(scene) == 'number' and scene >= 0 and scene == math.floor(scene) and not seen[scene], 'Invalid/duplicate population scene')
         seen[scene] = true
      end
   end
end

local function count_players()
   local old = game.reg[0]
   local count = 0
   local first = game.multiplayer_is_dedicated_server() and 1 or 0
   for player = first, game.get_max_players(0) - 1 do
      if game.player_is_active(player) then count = count + 1 end
   end
   game.reg[0] = old
   return count
end

function population_rotation_select()
   game.reg[0], game.reg[1] = -1, data and 1 or 0
   if not data or not game.multiplayer_is_server() then return end
   -- A duplicate tick cannot launch a second map. After a failed engine start,
   -- allow a retry of the same unconsumed queue entry after the skip cooldown.
   if pending and os.time() - pending.at < 10 then return end
   local count = count_players()
   local pool = 'small'
   if data.schema_version ~= 4 then
      pool = count <= data.small_max_players and 'small' or 'medium'
   end
   if data.schema_version >= 2 and count <= data.tiny_max_players then pool = 'tiny' end
   if data.schema_version >= 3 and count <= data.micro_max_players then pool = 'micro' end
   local index = cursors[pool]
   local scene = data.pools[pool][index]
   pending = {pool=pool, index=index, scene=scene, at=os.time()}
   game.server_add_message_to_log('[population-rotation v1] players=' .. count .. ' pool=' .. pool .. ' position=' .. index .. ' scene=' .. scene)
   game.reg[0], game.reg[1] = scene, 1
end

function population_rotation_mission_started(scene)
   if not data then return end
   if pending then
      if pending.scene == scene then
         cursors[pending.pool] = pending.index % #data.pools[pending.pool] + 1
      else
         game.server_add_message_to_log('[population-rotation v1] Unexpected scene; queue position retained.')
      end
      pending = nil
   elseif not started and scene == data.pools[pool_names[1]][1] then
      -- Config.txt starts this map before there is any transition request.
      cursors[pool_names[1]] = 1 % #data.pools[pool_names[1]] + 1
   end
   started = true
end
