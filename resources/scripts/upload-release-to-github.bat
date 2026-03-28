@echo off
chcp 65001 >nul
echo ========================================
echo    Upload Release to GitHub
echo ========================================
echo.

set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo [1/4] Kiểm tra files...
if not exist "dist-electron-output\93 Media - Tool Mix Nhạc-Setup-3.6.0.exe" (
    echo ❌ File installer không tồn tại!
    echo Vui lòng chạy: npm run build:win-installer
    pause
    exit /b 1
)

if not exist "dist-electron-output\latest.yml" (
    echo ⚠️  File latest.yml không tồn tại!
    echo File này cần thiết cho auto-update.
)

echo ✅ Files đã sẵn sàng
echo.

echo [2/4] Thông tin release...
for /f "tokens=2 delims=: " %%a in ('findstr /C:"\"version\"" package.json') do set VERSION=%%a
set VERSION=%VERSION:"=%
set VERSION=%VERSION:,=%
echo Version: %VERSION%
echo Tag: v%VERSION%
echo.

echo [3/4] Files cần upload:
echo   1. 93 Media - Tool Mix Nhạc-Setup-%VERSION%.exe
echo   2. latest.yml (metadata file)
echo.

echo [4/4] Hướng dẫn upload:
echo.
echo 1. Vào GitHub Releases:
echo    https://github.com/DungDT293/93-media-tool-releases/releases
echo.
echo 2. Nếu release v%VERSION% đã tồn tại:
echo    - Click vào release v%VERSION%
echo    - Click "Edit release" (icon bút chì)
echo    - Xóa file cũ (nếu có)
echo    - Kéo thả file mới: 93 Media - Tool Mix Nhạc-Setup-%VERSION%.exe
echo    - Kéo thả file: latest.yml
echo    - Click "Update release"
echo.
echo 3. Nếu tạo release mới:
echo    - Click "Create a new release"
echo    - Tag version: v%VERSION%
echo    - Release title: Version %VERSION%
echo    - Attach binaries: Kéo thả cả 2 files (.exe và latest.yml)
echo    - Click "Publish release"
echo.

echo ========================================
echo ✅ Hướng dẫn hoàn tất
echo ========================================
echo.
pause
