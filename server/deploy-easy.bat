@echo off
chcp 65001 >nul
echo ========================================
echo 🚀 Deploy Dashboard Lên Cloudflare Workers
echo ========================================
echo.

cd /d "%~dp0"

echo [Bước 1/3] Kiểm tra Wrangler...
npx wrangler --version
if %errorlevel% neq 0 (
    echo ❌ Wrangler không tìm thấy. Đang cài đặt...
    npm install -g wrangler
)

echo.
echo [Bước 2/3] Kiểm tra đăng nhập Cloudflare...
npx wrangler whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Chưa đăng nhập Cloudflare!
    echo.
    echo 📌 Bạn cần đăng nhập Cloudflare trước:
    echo    1. Chạy lệnh: npx wrangler login
    echo    2. Trình duyệt sẽ mở để bạn đăng nhập
    echo    3. Sau đó chạy lại script này
    echo.
    pause
    exit /b 1
)

echo ✅ Đã đăng nhập Cloudflare!
echo.

echo [Bước 3/3] Đang deploy lên Cloudflare Workers...
echo.
npx wrangler deploy

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo ✅ Deploy thành công!
    echo ========================================
    echo.
    echo 🌐 Dashboard URL: https://license-server.dungdong333.workers.dev/dashboard
    echo.
    echo 📋 Hãy kiểm tra:
    echo    - Tab "📦 Quản Lý Phiên Bản" đã xuất hiện
    echo    - Có thể load và save version policy
    echo.
) else (
    echo.
    echo ❌ Deploy thất bại!
    echo.
    echo 🔧 Kiểm tra:
    echo    - Đã login Cloudflare chưa? (npx wrangler login)
    echo    - Token có đủ quyền không?
    echo    - Database ID trong wrangler.toml có đúng không?
    echo.
)

pause
