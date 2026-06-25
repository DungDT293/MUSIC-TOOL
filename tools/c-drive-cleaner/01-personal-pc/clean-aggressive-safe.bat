@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\c-drive-cleaner.ps1" -AggressiveSafe -Force
pause
