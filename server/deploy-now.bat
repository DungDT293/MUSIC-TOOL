@echo off
chcp 65001 >nul
echo ========================================
echo 🚀 Deploy Server Code Lên Cloudflare Workers
echo ========================================
echo.

cd /d "%~dp0"

REM Set API Token
set CLOUDFLARE_API_TOKEN=%CLOUDFLARE_API_TOKEN%

echo [Bước 1/2] Đang deploy lên Cloudflare Workers...
echo.
npx wrangler deploy

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo ✅ Deploy thành công!
    echo ========================================
    echo.
    echo 🌐 Server URL: https://license-server.dungdong333.workers.dev
    echo 📋 Dashboard: https://license-server.dungdong333.workers.dev/dashboard
    echo.
    echo 📝 Đã sửa các vấn đề:
    echo    - Fix request body double-reading issue
    echo    - Add comprehensive error handling
    echo.
) else (
    echo.
    echo ❌ Deploy thất bại!
    echo.
    echo 🔧 Nếu lỗi về token, hãy thử:
    echo    1. Chạy: npx wrangler login
    echo    2. Hoặc tạo token mới tại: https://dash.cloudflare.com/profile/api-tokens
    echo.
)

pause
