@echo off
chcp 65001 >nul
echo ========================================
echo    Test Auto-Update với GitHub Releases
echo ========================================
echo.

set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo [1/4] Kiểm tra version hiện tại...
powershell -Command "(Get-Content 'package.json' | ConvertFrom-Json).version"
echo.

echo [2/4] Kiểm tra GitHub Releases...
echo Release URL: https://github.com/DungDT293/93-media-tool-releases/releases/tag/v3.6.0
echo.

echo [3/4] Hướng dẫn test:
echo.
echo 1. Đảm bảo app đã được build với version 3.5.9
echo 2. Chạy app: npm run dev
echo 3. App sẽ tự động check update khi khởi động
echo 4. Xem logs tại: %%APPDATA%%\93-media-tool-mix-nhac\logs\main.log
echo.

echo [4/4] Xem logs gần nhất...
echo.
powershell -Command "if (Test-Path '$env:APPDATA\93-media-tool-mix-nhac\logs\main.log') { Write-Host '=== Logs gần nhất (30 dòng cuối) ==='; Get-Content '$env:APPDATA\93-media-tool-mix-nhac\logs\main.log' -Tail 30 } else { Write-Host 'Log file chưa được tạo. Chạy app để tạo log file.' }"
echo.

echo ========================================
echo ✅ Test script hoàn tất
echo ========================================
echo.
echo 💡 Lưu ý:
echo    - App version hiện tại: 3.5.9 (để test)
echo    - GitHub Release version: 3.6.0
echo    - App sẽ thông báo có update mới khi check
echo.
pause
