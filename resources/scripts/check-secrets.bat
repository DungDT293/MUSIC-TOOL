@echo off
chcp 65001 >nul
echo ========================================
echo    Check Secrets - Version 3.6.1
echo ========================================
echo.

echo [1/3] Kiểm tra environment variables...
echo.

set "HAS_INSTALLER_SECRET=0"
set "HAS_INSTALLER_KEY=0"

if defined INSTALLER_SECRET (
    echo ✅ INSTALLER_SECRET: Đã set (length: %INSTALLER_SECRET:~0,1%...)
    set "HAS_INSTALLER_SECRET=1"
) else (
    echo ❌ INSTALLER_SECRET: KHÔNG có
)

if defined INSTALLER_KEY (
    echo ✅ INSTALLER_KEY: Đã set (length: %INSTALLER_KEY:~0,1%...)
    set "HAS_INSTALLER_KEY=1"
) else (
    echo ❌ INSTALLER_KEY: KHÔNG có
)

echo.

if "%HAS_INSTALLER_SECRET%"=="0" (
    echo ⚠️  WARNING: INSTALLER_SECRET không có!
    echo    App sẽ crash trong production mode nếu thiếu secret này.
    echo.
)

if "%HAS_INSTALLER_KEY%"=="0" (
    echo ⚠️  WARNING: INSTALLER_KEY không có!
    echo    App sẽ crash trong production mode nếu thiếu key này.
    echo.
)

if "%HAS_INSTALLER_SECRET%"=="1" if "%HAS_INSTALLER_KEY%"=="1" (
    echo ✅ Tất cả secrets đã có
) else (
    echo ❌ Thiếu secrets - đây có thể là nguyên nhân app không chạy!
    echo.
    echo 💡 Giải pháp:
    echo    1. Set environment variables trong System Properties
    echo    2. Hoặc tạo file .env trong thư mục cài đặt
    echo    3. Hoặc rebuild với secrets được embed
)

echo.
echo [2/3] Kiểm tra thư mục cài đặt...
set "APP_DIR=C:\Program Files\93-media-tool-mix-nhac"
if exist "%APP_DIR%" (
    echo ✅ Thư mục cài đặt tồn tại
    echo.
    echo [3/3] Kiểm tra .env files...
    if exist "%APP_DIR%\.env" (
        echo ✅ Tìm thấy .env file
    ) else (
        echo ❌ Không tìm thấy .env file
    )
    if exist "%APP_DIR%\.env.local" (
        echo ✅ Tìm thấy .env.local file
    ) else (
        echo ❌ Không tìm thấy .env.local file
    )
) else (
    echo ❌ Thư mục cài đặt không tồn tại
)

echo.
pause
