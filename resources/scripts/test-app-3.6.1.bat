@echo off
chcp 65001 >nul
echo ========================================
echo    Test App 3.6.1 - Debug Mode
echo ========================================
echo.

set "APP_PATH=C:\Program Files\93-media-tool-mix-nhac\93 Media - Tool Mix Nhạc.exe"

echo [1/3] Kiểm tra file app...
if not exist "%APP_PATH%" (
    echo ❌ File app không tồn tại tại: %APP_PATH%
    pause
    exit /b 1
)
echo ✅ File app tồn tại
echo.

echo [2/3] Chạy app và capture output...
echo.
echo ⚠️  App sẽ chạy trong cửa sổ này
echo ⚠️  Nếu có lỗi, sẽ hiển thị ở đây
echo ⚠️  Nhấn Ctrl+C để dừng app
echo.
echo ========================================
echo.

"%APP_PATH%"

echo.
echo ========================================
echo App đã thoát (hoặc crash)
echo ========================================
echo.
pause
