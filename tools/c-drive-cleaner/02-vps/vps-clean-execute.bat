@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\vps-c-drive-cleaner.ps1" -Execute -OlderThanDays 14
pause
