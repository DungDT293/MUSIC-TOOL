@echo off
REM Script: Upload Installer to Cloudflare R2
REM Mục đích: Upload file installer lên R2 bucket

setlocal enabledelayedexpansion

echo ========================================
echo 📤 Upload Installer to Cloudflare R2
echo ========================================
echo.

REM Get version from package.json
for /f "tokens=2 delims=:," %%a in ('findstr "version" package.json') do (
    set VERSION=%%a
    set VERSION=!VERSION:"=!
    set VERSION=!VERSION: =!
)

echo 📦 Version: %VERSION%
echo.

REM File names
set INSTALLER_NAME=93 Media - Tool Mix Nhạc-Setup-%VERSION%.exe
set SOURCE_FILE=dist-electron-output\%INSTALLER_NAME%
set R2_BUCKET=license-updates-files
set R2_KEY=win/%INSTALLER_NAME%

echo [1/3] Kiểm tra file installer...
if not exist "%SOURCE_FILE%" (
    echo ❌ Không tìm thấy file: %SOURCE_FILE%
    echo.
    echo 💡 Hãy build installer trước:
    echo    npm run build:win-installer
    exit /b 1
)
echo ✅ Tìm thấy: %INSTALLER_NAME%
echo.

echo [2/3] Kiểm tra Wrangler CLI...
where wrangler >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Wrangler CLI chưa được cài đặt
    echo.
    echo 💡 Cài đặt Wrangler:
    echo    npm install -g wrangler
    exit /b 1
)
echo ✅ Wrangler CLI đã sẵn sàng
echo.

echo [3/3] Upload file lên R2...
echo.
echo 📋 Thông tin upload:
echo    Bucket: %R2_BUCKET%
echo    Key: %R2_KEY%
echo    File: %SOURCE_FILE%
echo.

REM Escape spaces in file path for wrangler
set "ESCAPED_KEY=win/93 Media - Tool Mix Nhạc-Setup-%VERSION%.exe"

wrangler r2 object put "%R2_BUCKET%/%ESCAPED_KEY%" --file="%SOURCE_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ Upload thành công!
    echo ========================================
    echo.
    echo 📋 Thông tin:
    echo    Bucket: %R2_BUCKET%
    echo    Key: %R2_KEY%
    echo.
    echo 🔗 URL (qua Worker proxy):
    echo    https://license-updates-proxy.{your-subdomain}.workers.dev/win/%INSTALLER_NAME%
    echo.
    echo 💡 Bước tiếp theo:
    echo    1. Upload latest.yml lên R2
    echo    2. Test download file qua Worker URL
    echo    3. Update version policy nếu cần
    echo.
) else (
    echo.
    echo ❌ Upload thất bại!
    echo.
    echo 💡 Kiểm tra:
    echo    - Đã login wrangler chưa? (wrangler login)
    echo    - Bucket đã được tạo chưa?
    echo    - Có quyền truy cập bucket không?
    echo.
    exit /b 1
)

pause
