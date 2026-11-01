@echo off
setlocal
wsl.exe -d Ubuntu-22.04 --cd "%~dp0.." --exec python3 prepare_experimental_replays.py %*
set "result=%errorlevel%"
if not "%result%"=="0" echo Some recordings could not be prepared. See the messages above.
pause
exit /b %result%
