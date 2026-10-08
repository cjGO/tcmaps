-- Commander Battle round history. Identity is shared with /goodmap and /badmap.
local path = 'comms/map_round_stats.csv'
local legacy_header = 'map_name,round,result,remaining_time,duration_seconds\n'
local player_header = 'map_name,round,result,remaining_time,duration_seconds,player_count\n'
local header = 'map_name,round,result,remaining_time,duration_seconds,player_count,timestamp_utc\n'
local migration
local totals, loaded, failure = {}, false, nil
local enabled, round, current = false, 0, nil

local function add(name, result, duration, players)
   local t = totals[name] or {rounds=0, seconds=0, wins=0, players=0, counted=0}
   totals[name] = t
   t.rounds = t.rounds + 1
   t.seconds = t.seconds + duration
   t.wins = t.wins + (result == 'team1' and 1 or 0)
   if players then
      t.players, t.counted = t.players + players, t.counted + 1
   end
end

local function load()
   if loaded then return end
   local file, err, code = io.open(path, 'rb')
   if not file then
      assert(code == 2, err)
   else
      local data = assert(file:read('*a')); assert(file:close())
      data = data:gsub('\r\n', '\n') -- Accept CSVs saved by Windows text-mode tools.
      local old = data:sub(1, #legacy_header) == legacy_header
      local untimed = data:sub(1, #player_header) == player_header
      local active_header = old and legacy_header or untimed and player_header or header
      assert(data:sub(1, #active_header) == active_header, 'unexpected CSV header')
      local converted = {header}
      assert(data:sub(-1) == '\n', 'incomplete CSV row; repair before continuing')
      for row in data:sub(#active_header+1):gmatch('([^\n]+)\n') do
         if old then row = row .. ',' end
         if old or untimed then row = row .. ',' end
         local name, n, result, remaining, duration, players, timestamp = row:match('^([%w_%-]+),(%d+),([%w]+),(%d+),(%d+),(%d*),([^,]*)$')
         assert(name and tonumber(n) > 0 and (result == 'team1' or result == 'team2' or result == 'draw'), 'invalid CSV row')
         assert(timestamp == '' or timestamp:match('^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%dZ$'), 'invalid CSV timestamp')
         add(name, result, tonumber(duration), tonumber(players))
         converted[#converted+1] = row .. '\n'
      end
      if old or untimed then migration = table.concat(converted) end
   end
   loaded = true
end

-- Upgrade only when saving a new round; retain the original history as a backup.
local function migrate()
   if not migration then return end
   local backup = path .. '.before-timestamp.bak'
   local existing, err, code = io.open(backup, 'rb')
   if existing then existing:close(); error('migration backup already exists: ' .. backup) end
   assert(code == 2, err)
   local temporary = path .. '.tmp'
   local file = assert(io.open(temporary, 'wb'))
   local written, write_err = file:write(migration)
   local closed, close_err = file:close()
   assert(written, write_err); assert(closed, close_err)
   assert(os.rename(path, backup))
   local ok, rename_err = os.rename(temporary, path)
   if not ok then
      assert(os.rename(backup, path))
      error(rename_err)
   end
   migration = nil
end

local function player_count()
   local count = 0
   local maximum = game.get_max_players(0)
   local first = game.multiplayer_is_dedicated_server() and 1 or 0
   for player = first, maximum - 1 do
      if game.player_is_active(player) then count = count + 1 end
   end
   return count
end

local function guarded(fn)
   local r, s = game.reg[0], game.sreg[0]
   local ok, err = pcall(function()
      assert(not failure, failure)
      load()
      fn()
   end)
   game.reg[0], game.sreg[0] = r, s
   if not ok and not failure then
      failure = tostring(err)
      pcall(function() game.server_add_message_to_log('[mapstats] ' .. failure) end)
   end
   return ok
end

local function map_name()
   local scene, status = game.store_current_scene(0)
   assert(status == 0, 'current scene unavailable')
   local name = map_feedback_map_name(scene)
   -- Scene IDs and generated recipe IDs contain no CSV delimiters.
   assert(name:match('^[%w_%-]+$'), 'invalid map ID')
   return name
end

function comms_mapstats_event(event, a, b, c, d, e)
   if not game.multiplayer_is_server() then return end
   if event == 'statistics_mission' then
      enabled, round, current = a == 1, 0, nil
   elseif event == 'statistics_boundary' then
      current = nil
   elseif event == 'statistics_round_begin' then
      current = nil
   elseif event == 'statistics_tick' and a == 1 then
      current = nil
   elseif event == 'statistics_spawn' and enabled and not current and b == 0 and c == 0 and d == 0 then
      guarded(function()
         round = round + 1
         current = {name=map_name(), number=round}
      end)
   elseif event == 'statistics_round_end' and enabled and current then
      local finished = current
      current = nil -- Duplicate result callbacks must never append twice.
      if b ~= 0 or e ~= 0 then return end
      guarded(function()
         assert(a == -1 or a == 0 or a == 1, 'invalid winner')
         assert(type(c) == 'number' and type(d) == 'number', 'round timing bridge unavailable; rebuild missions')
         local now, status = game.store_mission_timer_a(0)
         assert(status == 0 and now >= c and d >= 0, 'invalid round timing')
         local duration = math.floor(now - c)
         local remaining = math.max(0, math.floor(d - duration))
         local result = a == -1 and 'draw' or a == 0 and 'team1' or 'team2'
         local players = player_count()
         local timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ')
         migrate()
         local file = assert(io.open(path, 'a+b'))
         local size = assert(file:seek('end'))
         local row = string.format('%s,%d,%s,%d,%d,%d,%s\n', finished.name, finished.number, result, remaining, duration, players, timestamp)
         local written, err = file:write((size == 0 and header or '') .. row)
         local closed, close_err = file:close()
         assert(written, err); assert(closed, close_err)
         add(finished.name, result, duration, players)
      end)
   end
end

local function reply(player, text)
   if player == 0 then
      if not game.multiplayer_is_dedicated_server() then game.display_message(text, 0xFFFFFF) end
   else
      game.multiplayer_send_string_to_player(player, 109, text)
   end
end

function comms_mapstats_command(player, command, argument)
   if command ~= '/mapstats' then return false end
   if not game.multiplayer_is_server() or not game.player_is_active(player) then return true end
   if argument ~= '' then reply(player, 'Usage: /mapstats'); return true end
   local message
   local ok = guarded(function()
      local name = map_name()
      local t = totals[name]
      if not t then
         message = name .. ' | Rounds: 0 | Average: N/A | Team 1 wins: N/A'
      else
         local seconds = math.floor(t.seconds / t.rounds + 0.5)
         message = string.format('%s | Rounds: %d | Average: %dm %02ds | Team 1 wins: %.1f%% (including draws)',
            name, t.rounds, math.floor(seconds / 60), seconds % 60, 100 * t.wins / t.rounds)
      end
      local average = t and t.counted > 0 and string.format('%.1f', t.players / t.counted) or 'N/A'
      message = message .. ' | Average players at round end: ' .. average
   end)
   reply(player, ok and message or 'Map statistics unavailable. Please tell a server admin.')
   -- A feedback read failure must not disable round recording or hide its history.
   local r, s = game.reg[0], game.sreg[0]
   local ratings_ok, ratings = pcall(function()
      local good, bad = map_feedback_ratings(map_name())
      return string.format('Map ratings | Good: %d | Bad: %d', good, bad)
   end)
   game.reg[0], game.sreg[0] = r, s
   if not ratings_ok then
      pcall(function() game.server_add_message_to_log('[mapstats ratings] ' .. tostring(ratings)) end)
   end
   reply(player, ratings_ok and ratings or 'Map ratings unavailable. Please tell a server admin.')
   return true
end
