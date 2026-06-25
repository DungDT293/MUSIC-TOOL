@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\vps-c-drive-cleaner.ps1" -OlderThanDays 14
pause
