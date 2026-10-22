@echo off
title Install Kokoro voices
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-kokoro.ps1" %*
pause
