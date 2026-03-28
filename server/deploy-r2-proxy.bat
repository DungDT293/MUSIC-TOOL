@echo off
REM Script: Deploy R2 Proxy Worker
REM Mục đích: Deploy Worker để proxy files từ R2 bucket

echo ========================================
echo 🚀 Deploy R2 Proxy Worker
echo ========================================
echo.

REM Check if wrangler is installed
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

REM Change to server directory
cd /d "%~dp0"

echo [1/2] Kiểm tra cấu hình...
if not exist "r2-proxy-worker.js" (
    echo ❌ Không tìm thấy file: r2-proxy-worker.js
    exit /b 1
)
if not exist "wrangler-r2-proxy.toml" (
    echo ❌ Không tìm thấy file: wrangler-r2-proxy.toml
    exit /b 1
)
echo ✅ Cấu hình đã sẵn sàng
echo.

echo [2/2] Deploy Worker...
echo.

REM Deploy using custom config
wrangler deploy --config wrangler-r2-proxy.toml

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ Deploy thành công!
    echo ========================================
    echo.
    echo 💡 Bước tiếp theo:
    echo    1. Test Worker URL trong browser
    echo    2. Upload files lên R2 bucket
    echo    3. Test download file qua Worker
    echo.
) else (
    echo.
    echo ❌ Deploy thất bại!
    echo.
    echo 💡 Kiểm tra:
    echo    - Đã login wrangler chưa? (wrangler login)
    echo    - R2 bucket đã được tạo chưa?
    echo    - Bucket name trong wrangler-r2-proxy.toml có đúng không?
    echo.
    exit /b 1
)

pause
