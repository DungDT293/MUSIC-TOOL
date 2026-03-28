@echo off
chcp 65001 >nul
echo ========================================
echo    Upload Version 3.6.1 to GitHub Releases
echo ========================================
echo.

set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo [1/4] Kiểm tra files...
if not exist "dist-electron-output\93 Media - Tool Mix Nhạc-Setup-3.6.1.exe" (
    echo ❌ File installer không tồn tại!
    echo Vui lòng chạy: npm run build:win-installer
    pause
    exit /b 1
)

if not exist "dist-electron-output\latest.yml" (
    echo ⚠️  File latest.yml không tồn tại!
    echo File này cần thiết cho auto-update.
    pause
    exit /b 1
)

echo ✅ Files đã sẵn sàng
echo.

echo [2/4] Thông tin release...
echo Version: 3.6.1
echo Tag: v3.6.1
echo.

echo [3/4] Files cần upload:
echo   1. 93 Media - Tool Mix Nhạc-Setup-3.6.1.exe
echo   2. latest.yml (metadata file)
echo.

echo [4/4] Hướng dẫn upload:
echo.
echo 1. Vào GitHub Releases:
echo    https://github.com/DungDT293/93-media-tool-releases/releases/new
echo.
echo 2. Điền thông tin:
echo    - Tag version: v3.6.1
echo    - Release title: Version 3.6.1
echo    - Description: Version 3.6.1 - Test build
echo.
echo 3. Upload files:
echo    - Kéo thả: 93 Media - Tool Mix Nhạc-Setup-3.6.1.exe
echo    - Kéo thả: latest.yml
echo.
echo 4. Click "Publish release"
echo.

echo ========================================
echo ✅ Hướng dẫn hoàn tất
echo ========================================
echo.
echo 💡 Test sau khi upload:
echo    - Cài đặt version 3.6.1
echo    - Verify yêu cầu đăng ký mới
echo    - Check logs: %%APPDATA%%\93-media-tool-mix-nhac\logs\main.log
echo.
pause
