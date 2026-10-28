local function reply(player, message)
   if player == 0 then
      if not game.multiplayer_is_dedicated_server() then
         game.display_message(message, 0xFFFFFF)
      end
   else
      game.multiplayer_send_string_to_player(player, 109, message)
   end
end

function comms_bugreport_help(player)
   if not game.multiplayer_is_server() or not game.player_is_active(player) then return end
   reply(player, '/feedback <message> - Send notes to admins. | /feature <message> - Suggest a feature. | /bugreport - Visit https://tcmaps.vercel.app and use the bug report Discord channel linked there.')
end

local function csv_field(value)
   if value:find('[,"\r\n]') then
      return '"' .. value:gsub('"', '""') .. '"'
   end
   return value
end

local report_commands = {
   ['/bugreport'] = {notice = 'Bug reports have moved! Visit https://tcmaps.vercel.app and use the bug report Discord channel linked there.'},
   ['/feature'] = {path = 'comms/feedback_messages.csv', label = 'Feature request'},
   ['/feedback'] = {path = 'comms/feedback_messages.csv', label = 'Feedback'},
}

-- Shared by bug reports and feedback; keep the existing chat entry point.
-- Parse the original chat text so report capitalization is preserved.
function comms_bugreport_command(player, text)
   local command, message = string.match(text or '', '^(%S+)%s*(.-)%s*$')
   command = command and string.lower(command)
   local report = report_commands[command]
   if not report then return false end
   if not game.multiplayer_is_server() or not game.player_is_active(player) then return true end
   if report.notice then
      reply(player, report.notice)
      return true
   end
   if message == '' then
      reply(player, 'Usage: ' .. command .. ' <enter your message here>')
      return true
   end

   local previous = game.reg[0]
   local previous_name = game.sreg[0]
   local ok, err = pcall(function()
      local uid, status = game.player_get_unique_id(0, player)
      assert(status == 0 and type(uid) == 'number' and uid > 1 and uid == math.floor(uid), 'player ID unavailable')
      assert(game.str_store_player_username(0, player) == 0, 'player name unavailable')
      local player_name = game.sreg[0]
      assert(type(player_name) == 'string' and player_name ~= '', 'player name unavailable')
      local row = string.format('%s,%.0f,%s,%s\n',
         os.date('!%Y-%m-%dT%H:%M:%SZ'), uid, csv_field(message), csv_field(player_name))
      local file = assert(io.open(report.path, 'a'))
      local written, write_error = file:write(row)
      local closed, close_error = file:close()
      assert(written, write_error)
      assert(closed, close_error)
      print('[' .. command .. '] ' .. player_name:gsub('[%c]', ' ') .. ': ' .. message:gsub('[%c]', ' '))
   end)
   game.reg[0] = previous
   game.sreg[0] = previous_name
   if ok then
      reply(player, report.label .. ' saved. Thank you!')
   else
      game.server_add_message_to_log(report.label .. ' FAILED: ' .. tostring(err))
      reply(player, report.label .. ' could not be saved. Please tell a server admin.')
   end
   return true
end
