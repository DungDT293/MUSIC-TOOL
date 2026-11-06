@echo off
chcp 65001 >nul
echo ========================================
echo 🔐 Set Admin Token cho Cloudflare Workers
echo ========================================
echo.

cd /d "%~dp0"

echo [Bước 1/2] Set Cloudflare API Token...
set CLOUDFLARE_API_TOKEN=%CLOUDFLARE_API_TOKEN%

echo.
echo [Bước 2/2] Set ADMIN_TOKEN secret...
echo.
echo ⚠️  LƯU Ý: 
echo    - Bạn sẽ được hỏi nhập ADMIN_TOKEN
echo    - Token này sẽ dùng để đăng nhập dashboard
echo    - Nhập token và nhấn Enter (không hiển thị khi gõ)
echo.
pause

npx wrangler secret put ADMIN_TOKEN

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo ✅ Đã set ADMIN_TOKEN thành công!
    echo ========================================
    echo.
    echo 📋 Bây giờ bạn có thể:
    echo    1. Mở dashboard: https://license-server.dungdong333.workers.dev/dashboard
    echo    2. Nhập ADMIN_TOKEN vừa set để đăng nhập
    echo.
) else (
    echo.
    echo ❌ Set token thất bại!
    echo.
)

pause
