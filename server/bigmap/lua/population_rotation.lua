-- Population is sampled only when an automatic map transition is committed.
-- Cursors advance on the mission-start callback, never on selection/announcement.
local file = io.open('population_rotation_data.lua', 'rb')
local data
if file then file:close(); data = dofile('population_rotation_data.lua') end
local cursors = {micro=1, tiny=1, small=1, medium=1}
local pool_names = data and data.schema_version == 4 and {'micro', 'tiny', 'small'} or data and data.schema_version == 3 and {'micro', 'tiny', 'small', 'medium'} or data and data.schema_version == 2 and {'tiny', 'small', 'medium'} or {'small', 'medium'}
local pending, started = nil, false
local completed, variant_cursor = 0, 1
local variant_scenes = {}
local function variant_due()
   return data and data.variant_every and (completed + 1) % data.variant_every == 0
end
local forced_scene
local bigmap_pool = data and (data.bigmap_pool or data.pools.medium)
local size_votes, passed_size, last_scene = {}, nil, nil
local vote_pools = {medium=bigmap_pool, tiny=data and data.pools.tiny}
local vote_labels = {medium='Large-map', tiny='Tiny-map'}
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
   if data.bigmap_pool then
      assert(data.schema_version == 4 and #data.bigmap_pool > 0, 'Invalid bigmap pool')
      for _, scene in ipairs(data.bigmap_pool) do
         assert(type(scene) == 'number' and scene >= 0 and scene == math.floor(scene) and not seen[scene], 'Invalid/duplicate bigmap scene')
         seen[scene] = true
      end
   end
   if data.variant_every then
      assert(data.variant_every == 4 and type(data.variant_pool) == 'table' and #data.variant_pool > 0, 'Invalid variant cadence')
      for _, scene in ipairs(data.variant_pool) do
         assert(seen[scene] and not variant_scenes[scene], 'Invalid variant scene')
         variant_scenes[scene] = true
      end
      -- Scheduled variants have their own cursor, independent of population.
      local function raw_queue(queue)
         local raw = {}
         for _, scene in ipairs(queue) do
            if not variant_scenes[scene] then raw[#raw + 1] = scene end
         end
         assert(#raw > 0, 'Empty non-variant queue')
         return raw
      end
      for _, pool in ipairs(pool_names) do data.pools[pool] = raw_queue(data.pools[pool]) end
      if bigmap_pool then bigmap_pool = raw_queue(bigmap_pool) end
      vote_pools = {medium=bigmap_pool, tiny=data.pools.tiny}
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

local function reply(player, text)
   if player == 0 and not game.multiplayer_is_dedicated_server() then
      game.display_message(text, 0xFFFFFF)
   else
      game.multiplayer_send_string_to_player(player, 109, text)
   end
end

local function broadcast(text)
   local reg0 = game.reg[0]
   local first = game.multiplayer_is_dedicated_server() and 1 or 0
   for player = first, game.get_max_players(0) - 1 do
      if game.player_is_active(player) then reply(player, text) end
   end
   game.reg[0] = reg0
end

local function voter_id(player)
   local uid, status = game.player_get_unique_id(0, player)
   assert(status == 0 and type(uid) == 'number' and uid > 1 and uid == math.floor(uid), 'player identity unavailable')
   return uid
end

-- Recount connected voters both on votes and at the transition itself.
local function size_ballot(size)
   local connected, votes, humans = {}, 0, 0
   local first = game.multiplayer_is_dedicated_server() and 1 or 0
   for slot = first, game.get_max_players(0) - 1 do
      if game.player_is_active(slot) then
         humans = humans + 1
         connected[voter_id(slot)] = true
      end
   end
   for id, choice in pairs(size_votes) do
      if not connected[id] then size_votes[id] = nil
      elseif choice == size then votes = votes + 1 end
   end
   local required = math.floor(humans / 2) + 1
   local chance = humans > 0 and math.min(40, 80 * votes / humans) or 0
   if votes >= required then chance = 100 end
   return votes, required, chance
end

-- Both vote shares occupy disjoint intervals of one draw. The remainder uses
-- normal population routing, which may itself already select tiny or medium.
local function size_chance(size)
   local pool = vote_pools[size]
   if not pool or #pool == 0 then return 0 end
   if forced_scene or variant_due() then return 0 end
   if pending then return pending.pool == size and 100 or 0 end
   if passed_size then return passed_size == size and 100 or 0 end
   local _, _, chance = size_ballot(size)
   return chance
end

local function size_chance_text(size)
   local label = size == 'medium' and 'a bigger map' or 'a tiny map'
   return 'Current chance of ' .. label .. ': ' .. string.format('%.1f', size_chance(size)) .. '%.'
end

local function size_reply(player, text, size)
   local other = size == 'medium' and 'tiny' or 'medium'
   reply(player, text .. ' ' .. size_chance_text(size) .. ' ' .. size_chance_text(other))
end

function editanna_command(player, command, argument)
   if command ~= '/editanna' then return false end
   if not game.multiplayer_is_server() or not game.player_is_active(player) or
      (player == 0 and game.multiplayer_is_dedicated_server()) then return true end
   if argument ~= '' then reply(player, 'Usage: /editanna'); return true end
   if pending then
      reply(player, 'The next map is already loading. Use /editanna after it starts.'); return true
   end
   local ok, identities = pcall(dofile, 'map_identity_data.lua')
   local scene
   if data and ok and type(identities) == 'table' then
      for candidate, identity in pairs(identities) do
         if identity.map_id == 'test_map_176' and identity.map_name == 'test_map_176_VarA' then
            if scene then
               reply(player, 'Multiple installed test_map_176_VarA maps found. Please tell the server admin.'); return true
            end
            scene = candidate
         end
      end
   end
   if not scene then
      reply(player, 'test_map_176_VarA is not installed. Please tell the server admin.'); return true
   end
   forced_scene = scene
   passed_size, size_votes = nil, {}
   broadcast('test_map_176_VarA is queued as the next map, regardless of server population.')
   return true
end

-- Keep the existing entry point for both native and global chat dispatchers.
function bigmap_command(player, command, argument)
   local size = command == '/bigmap' and 'medium' or command == '/tinymap' and 'tiny'
   if not size then return false end
   if not game.multiplayer_is_server() or not game.player_is_active(player) or
      (player == 0 and game.multiplayer_is_dedicated_server()) then return true end
   local reg0, reg1, name = game.reg[0], game.reg[1], game.sreg[0]
   local ok, err = pcall(function()
      local force_pass = argument == 'true'
      local function respond(text) size_reply(player, text, size) end
      if argument ~= '' and not force_pass then respond('Usage: ' .. command); return end
      if force_pass and not game.player_is_admin(player) then
         respond(command .. ' true is for admins only.'); return
      end
      if not vote_pools[size] or #vote_pools[size] == 0 then
         respond('No installed ' .. size .. ' maps are available for ' .. command .. '.'); return
      end
      if pending then
         respond('The next map is already loading. Vote with ' .. command .. ' after it starts.'); return
      end
      if forced_scene then
         respond('test_map_176_VarA is already queued as the next map.'); return
      end
      if passed_size then
         respond('The ' .. vote_labels[passed_size]:lower() .. ' vote has already passed for the next map.'); return
      end
      if force_pass then
         passed_size = size
         broadcast(vote_labels[size] .. ' vote passed. ' .. size_chance_text(size))
         return
      end
      local uid = voter_id(player)
      size_ballot(size)
      if size_votes[uid] == size then
         respond('You have already voted for a ' .. (size == 'medium' and 'large' or 'tiny') .. ' map for the next map.'); return
      end
      assert(game.str_store_player_username(0, player) == 0, 'player name unavailable')
      local player_name = game.sreg[0]
      assert(type(player_name) == 'string' and player_name ~= '', 'player name unavailable')
      size_votes[uid] = size
      local votes, required, chance = size_ballot(size)
      broadcast(player_name .. ' voted for a ' .. size .. ' map: ' .. votes .. '/' .. required ..
         ' votes to guarantee it; current chance ' .. string.format('%.1f', chance) .. '%. Vote with ' .. command)
      if votes >= required then
         passed_size = size
         broadcast(vote_labels[size] .. ' vote passed. The next map will use the next installed ' .. size .. ' map. ' .. size_chance_text(size))
      end
   end)
   game.reg[0], game.reg[1], game.sreg[0] = reg0, reg1, name
   if not ok then
      game.server_add_message_to_log('[' .. command:sub(2) .. '] ' .. tostring(err))
      reply(player, command .. ' could not be processed. Current map-size chances are unavailable. Please tell the server admin.')
   end
   return true
end

function population_rotation_select()
   game.reg[0], game.reg[1] = -1, data and 1 or 0
   if not data or not game.multiplayer_is_server() then return end
   -- A duplicate tick cannot launch a second map. After a failed engine start,
   -- allow a retry of the same unconsumed queue entry after the skip cooldown.
   if pending then
      if os.time() - pending.at < 10 then return end
      pending.at = os.time()
      game.reg[0], game.reg[1] = pending.scene, 1
      return
   end
   if variant_due() then
      local scene = data.variant_pool[variant_cursor]
      pending = {scene=scene, at=os.time(), variant=true}
      game.server_add_message_to_log('[population-rotation] scheduled variant scene=' .. scene)
      game.reg[0], game.reg[1] = scene, 1
      return
   end
   if forced_scene then
      pending = {scene=forced_scene, at=os.time(), forced=true}
      game.server_add_message_to_log('[editanna] next map=test_map_176_VarA scene=' .. forced_scene)
      game.reg[0], game.reg[1] = forced_scene, 1
      return
   end
   local count = count_players()
   local pool = 'small'
   if data.schema_version ~= 4 then
      pool = count <= data.small_max_players and 'small' or 'medium'
   end
   if data.schema_version >= 2 and count <= data.tiny_max_players then pool = 'tiny' end
   if data.schema_version >= 3 and count <= data.micro_max_players then pool = 'micro' end
   local chosen_size = passed_size
   if not chosen_size and next(size_votes) then
      local medium_chance, tiny_chance = size_chance('medium'), size_chance('tiny')
      if medium_chance == 100 then chosen_size = 'medium'
      elseif tiny_chance == 100 then chosen_size = 'tiny'
      elseif medium_chance + tiny_chance > 0 then
         local roll = math.random() * 100
         if roll < medium_chance then chosen_size = 'medium'
         elseif roll < medium_chance + tiny_chance then chosen_size = 'tiny' end
      end
      -- A winning roll, like a passed vote, survives a failed/unexpected start.
      passed_size = chosen_size
   end
   if chosen_size then pool = chosen_size end
   local index = cursors[pool]
   local queue = chosen_size and vote_pools[chosen_size] or data.pools[pool]
   local scene = queue[index]
   pending = {pool=pool, index=index, scene=scene, at=os.time(), voted_size=chosen_size, queue=queue}
   game.server_add_message_to_log('[population-rotation v1] players=' .. count .. ' pool=' .. pool .. ' position=' .. index .. ' scene=' .. scene)
   game.reg[0], game.reg[1] = scene, 1
end

function population_rotation_mission_started(scene)
   if not data then return end
   local new_mission = pending ~= nil or not started or scene ~= last_scene
   if pending then
      if pending.scene == scene then
         completed = completed + 1
         if pending.variant then
            variant_cursor = variant_cursor % #data.variant_pool + 1
         elseif pending.forced then
            forced_scene = nil
         else
            cursors[pending.pool] = pending.index % #pending.queue + 1
            if pending.voted_size then passed_size = nil end
         end
      else
         game.server_add_message_to_log('[population-rotation v1] Unexpected scene; queue position retained.')
      end
      pending = nil
   elseif not started and scene == data.pools[pool_names[1]][1] then
      completed = completed + 1
      -- Config.txt starts this map before there is any transition request.
      cursors[pool_names[1]] = 1 % #data.pools[pool_names[1]] + 1
   end
   if new_mission then size_votes = {} end
   last_scene = scene
   started = true
end
