@echo off
rem Lieferando agent launcher: restarts the agent after self-update or crash.
cd /d %~dp0
:loop
node agent.mjs
echo agent exited with code %errorlevel%, restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
