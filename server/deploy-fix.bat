@echo off
chcp 65001 >nul
echo ========================================
echo 🚀 Deploy Server Code Lên Cloudflare Workers
echo ========================================
echo.

cd /d "%~dp0"

echo [Bước 1/3] Kiểm tra Wrangler...
npx wrangler --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Wrangler không tìm thấy. Đang cài đặt...
    npm install -g wrangler
    if %errorlevel% neq 0 (
        echo ❌ Không thể cài đặt wrangler!
        pause
        exit /b 1
    )
)

echo.
echo [Bước 2/3] Kiểm tra đăng nhập Cloudflare...
npx wrangler whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Chưa đăng nhập Cloudflare!
    echo.
    echo 📌 Đang thử dùng API Token...
    set CLOUDFLARE_API_TOKEN=%CLOUDFLARE_API_TOKEN%
    npx wrangler whoami >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ API Token không hợp lệ hoặc không đủ quyền!
        echo.
        echo 📌 Bạn cần đăng nhập Cloudflare trước:
        echo    1. Chạy lệnh: npx wrangler login
        echo    2. Trình duyệt sẽ mở để bạn đăng nhập
        echo    3. Sau đó chạy lại script này
        echo.
        pause
        exit /b 1
    )
    echo ✅ API Token hợp lệ!
) else (
    echo ✅ Đã đăng nhập Cloudflare!
)

@echo off
chcp 65001 >nul
echo ========================================
echo 🚀 Deploy Server Code Lên Cloudflare Workers
echo ========================================
echo.

cd /d "%~dp0"

echo [Bước 1/3] Kiểm tra Wrangler...
npx wrangler --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Wrangler không tìm thấy. Đang cài đặt...
    npm install -g wrangler
    if %errorlevel% neq 0 (
        echo ❌ Không thể cài đặt wrangler!
        pause
        exit /b 1
    )
)

echo.
echo [Bước 2/3] Kiểm tra đăng nhập Cloudflare...
npx wrangler whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Chưa đăng nhập Cloudflare!
    echo.
    echo 📌 Đang thử dùng API Token...
    set CLOUDFLARE_API_TOKEN=%CLOUDFLARE_API_TOKEN%
    npx wrangler whoami >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ API Token không hợp lệ hoặc không đủ quyền!
        echo.
        echo 📌 Bạn cần đăng nhập Cloudflare trước:
        echo    1. Chạy lệnh: npx wrangler login
        echo    2. Trình duyệt sẽ mở để bạn đăng nhập
        echo    3. Sau đó chạy lại script này
        echo.
        pause
        exit /b 1
    )
    echo ✅ API Token hợp lệ!
) else (
    echo ✅ Đã đăng nhập Cloudflare!
)

echo.
echo [Bước 3/3] Đang deploy lên Cloudflare Workers...
echo.
set CLOUDFLARE_API_TOKEN=%CLOUDFLARE_API_TOKEN%
call npx wrangler deploy

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
    echo ✅ Bây giờ bạn có thể test lại đăng ký từ client app!
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
