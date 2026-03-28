@echo off
chcp 65001 >nul
echo ========================================
echo 🔄 Chạy Migration Tạo Bảng auth_audit_logs
echo ========================================
echo.

REM Lấy ADMIN_TOKEN từ environment
if "%ADMIN_TOKEN%"=="" (
    echo ⚠️  ADMIN_TOKEN chưa được set trong environment
    echo.
    echo 📌 Bạn cần set ADMIN_TOKEN trước:
    echo    set ADMIN_TOKEN=your-admin-token-here
    echo.
    echo Hoặc nhập ADMIN_TOKEN ngay bây giờ:
    set /p ADMIN_TOKEN="Nhập ADMIN_TOKEN: "
)

if "%ADMIN_TOKEN%"=="" (
    echo ❌ ADMIN_TOKEN là bắt buộc!
    pause
    exit /b 1
)

set URL=https://license-server.dungdong333.workers.dev/api/migrate/v2

echo [Bước 1/2] Đang gọi migration endpoint...
echo URL: %URL%
echo.

curl -X POST "%URL%" ^
  -H "x-admin-token: %ADMIN_TOKEN%" ^
  -H "Content-Type: application/json"

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo ✅ Migration thành công!
    echo ========================================
    echo.
    echo 📝 Đã tạo bảng auth_audit_logs với các cột:
    echo    - id, username, event_type, severity
    echo    - ip_address, machine_id, details, timestamp
    echo.
    echo ✅ Bây giờ bạn có thể kiểm tra bảng auth_audit_logs trong Cloudflare D1 Database Studio!
    echo.
) else (
    echo.
    echo ❌ Migration thất bại!
    echo.
    echo 🔧 Kiểm tra:
    echo    - ADMIN_TOKEN có đúng không?
    echo    - Server đã được deploy chưa?
    echo    - Kết nối mạng có ổn không?
    echo.
)

pause
