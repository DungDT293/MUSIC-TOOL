@echo off
REM Script: Setup GitHub Releases
REM Mục đích: Tự động update code với thông tin GitHub của bạn

setlocal enabledelayedexpansion

echo ========================================
echo 🚀 Setup GitHub Releases
echo ========================================
echo.

echo [1/4] Nhập thông tin GitHub...
echo.

set /p GITHUB_USERNAME="Nhập GitHub username của bạn: "
if "!GITHUB_USERNAME!"=="" (
    echo ❌ Cần GitHub username
    exit /b 1
)

set /p GITHUB_REPO="Nhập tên repository (ví dụ: 93-media-tool-releases): "
if "!GITHUB_REPO!"=="" (
    set GITHUB_REPO=93-media-tool-releases
    echo ℹ️  Dùng tên mặc định: 93-media-tool-releases
)

echo.
echo [2/4] Đang update electron-builder.json5...
powershell -Command "(Get-Content 'electron-builder.json5') -replace 'your-github-username', '!GITHUB_USERNAME!' | Set-Content 'electron-builder.json5'"
powershell -Command "(Get-Content 'electron-builder.json5') -replace '93-media-tool-releases', '!GITHUB_REPO!' | Set-Content 'electron-builder.json5'"
echo ✅ Đã update electron-builder.json5

echo.
echo [3/4] Đang update electron/updater.ts...
powershell -Command "(Get-Content 'electron/updater.ts') -replace 'your-github-username', '!GITHUB_USERNAME!' | Set-Content 'electron/updater.ts'"
powershell -Command "(Get-Content 'electron/updater.ts') -replace '93-media-tool-releases', '!GITHUB_REPO!' | Set-Content 'electron/updater.ts'"
echo ✅ Đã update electron/updater.ts

echo.
echo [4/4] Tóm tắt...
echo.
echo ========================================
echo ✅ Setup hoàn tất!
echo ========================================
echo.
echo 📋 Thông tin đã cấu hình:
echo    GitHub Username: !GITHUB_USERNAME!
echo    Repository: !GITHUB_REPO!
echo.
echo 🔗 Repository URL:
echo    https://github.com/!GITHUB_USERNAME!/!GITHUB_REPO!
echo.
echo 💡 Bước tiếp theo:
echo    1. Tạo repository trên GitHub (nếu chưa có):
echo       https://github.com/new
echo       Tên: !GITHUB_REPO!
echo.
echo    2. Build và upload file:
echo       npm run build:win-installer
echo       Sau đó upload file lên GitHub Releases
echo.
echo    3. Xem hướng dẫn chi tiết:
echo       docs/HUONG_DAN_GITHUB_RELEASES.md
echo.

pause
