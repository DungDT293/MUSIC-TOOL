@echo off
chcp 65001 >nul
echo ========================================
echo 🔐 Set Admin Token: <ADMIN_TOKEN>
echo ========================================
echo.

cd /d "%~dp0"

echo [Bước 1/2] Set Cloudflare API Token...
set CLOUDFLARE_API_TOKEN=%CLOUDFLARE_API_TOKEN%

echo.
echo [Bước 2/2] Set ADMIN_TOKEN = <ADMIN_TOKEN>...
echo.

echo %ADMIN_TOKEN%| npx wrangler secret put ADMIN_TOKEN

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo ✅ Đã set ADMIN_TOKEN thành công!
    echo ========================================
    echo.
    echo 📋 Token: <ADMIN_TOKEN>
    echo.
    echo 🌐 Bây giờ bạn có thể:
    echo    1. Mở dashboard: https://license-server.dungdong333.workers.dev/dashboard
    echo    2. Nhập token: <ADMIN_TOKEN>
    echo    3. Click "Đăng Nhập"
    echo.
) else (
    echo.
    echo ❌ Set token thất bại!
    echo.
    echo 💡 Thử cách thủ công:
    echo    npx wrangler secret put ADMIN_TOKEN
    echo    (Sau đó nhập: <ADMIN_TOKEN>)
    echo.
)

pause
