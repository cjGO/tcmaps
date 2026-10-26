-- Append connection events immediately; never rewrite historical activity.
local path = 'comms/player_activity.csv'
local header = 'player_id,player_name,login_utc,logout_utc\n'

-- Retain connection identities across Lua reloads and map changes. Departure
-- callbacks may run after the player's ID/name have become unavailable.
_comms_player_activity_sessions = _comms_player_activity_sessions or {}
local sessions = _comms_player_activity_sessions

local function csv_field(value)
   if value:find('[,"\r\n]') then
      return '"' .. value:gsub('"', '""') .. '"'
   end
   return value
end

local function append(session, logout)
   local row = string.format('%.0f,%s,%s,%s\n', session.uid,
      csv_field(session.name), session.login, logout or '')
   local file = assert(io.open(path, 'a+b'))
   local ok, err = pcall(function()
      local size = assert(file:seek('end'))
      if size == 0 then
         row = header .. row
      else
         assert(file:seek('set', 0))
         local first = file:read('*l')
         assert(first and first:gsub('\r$', '') == header:sub(1, -2),
            'unexpected player activity CSV header')
         assert(file:seek('end'))
      end
      assert(file:write(row))
   end)
   local closed, close_error = file:close()
   assert(ok, err)
   assert(closed, close_error)
end

function comms_player_activity_event(event, player)
   if event ~= 'statistics_join' and event ~= 'statistics_leave' then return end
   if not game.multiplayer_is_server() then return end
   if player == 0 and game.multiplayer_is_dedicated_server() then return end
   local previous, previous_name = game.reg[0], game.sreg[0]
   local ok, err = pcall(function()
      if event == 'statistics_join' then
         if not game.player_is_active(player) then return end
         local uid, status = game.player_get_unique_id(0, player)
         assert(status == 0 and type(uid) == 'number' and uid > 1 and uid == math.floor(uid),
            'player ID unavailable')
         if sessions[player] and sessions[player].uid == uid then return end
         -- A reused slot must never inherit another player's login time.
         sessions[player] = nil
         assert(game.str_store_player_username(0, player) == 0, 'player name unavailable')
         local name = game.sreg[0]
         assert(type(name) == 'string' and name ~= '', 'player name unavailable')
         local session = {uid=uid, name=name, login=os.date('!%Y-%m-%dT%H:%M:%SZ')}
         sessions[player] = session
         append(session)
      else
         local session = sessions[player]
         if not session then return end
         sessions[player] = nil
         append(session, os.date('!%Y-%m-%dT%H:%M:%SZ'))
      end
   end)
   game.reg[0], game.sreg[0] = previous, previous_name
   if not ok then
      -- A logging failure must not interrupt the original native callback.
      pcall(function() game.server_add_message_to_log('[player activity] ' .. tostring(err)) end)
   end
end
