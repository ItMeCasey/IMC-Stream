@echo off
title ItMeCasey Stream Server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8420/
:run
node server.js
rem exit code 75 = "restart me" (used by the app's restart button); anything else ends the window
if %errorlevel%==75 goto run
pause
