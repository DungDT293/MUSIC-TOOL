@echo off
chcp 65001 >nul
echo ========================================
echo 🔐 Set Admin Token: Dung28072022
echo ========================================
echo.

cd /d "%~dp0"

echo [Bước 1/2] Set Cloudflare API Token...
set CLOUDFLARE_API_TOKEN=ilJo9lCFk4VV7qbdC5WgkjJYTVF6y4xF3Le26Ied

echo.
echo [Bước 2/2] Set ADMIN_TOKEN = Dung28072022...
echo.

echo Dung28072022| npx wrangler secret put ADMIN_TOKEN

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo ✅ Đã set ADMIN_TOKEN thành công!
    echo ========================================
    echo.
    echo 📋 Token: Dung28072022
    echo.
    echo 🌐 Bây giờ bạn có thể:
    echo    1. Mở dashboard: https://license-server.dungdong333.workers.dev/dashboard
    echo    2. Nhập token: Dung28072022
    echo    3. Click "Đăng Nhập"
    echo.
) else (
    echo.
    echo ❌ Set token thất bại!
    echo.
    echo 💡 Thử cách thủ công:
    echo    npx wrangler secret put ADMIN_TOKEN
    echo    (Sau đó nhập: Dung28072022)
    echo.
)

pause
