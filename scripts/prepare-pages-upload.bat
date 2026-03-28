@echo off
chcp 65001 >nul
echo ========================================
echo 📤 Prepare Files for Cloudflare Pages Upload
echo ========================================
echo.

cd /d "%~dp0\.."

powershell -ExecutionPolicy Bypass -File "scripts\prepare-pages-upload.ps1" %*

if %errorlevel% neq 0 (
    echo.
    echo ❌ Có lỗi xảy ra!
    pause
    exit /b 1
)

echo.
pause
