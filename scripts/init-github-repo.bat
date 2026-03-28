@echo off
chcp 65001 >nul
echo ========================================
echo    Initialize GitHub Repository
echo ========================================
echo.

set "REPO_DIR=%~dp0.."
cd /d "%REPO_DIR%"

echo [1/3] Kiểm tra Git...
git --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Git chưa được cài đặt!
    echo Vui lòng cài đặt Git từ https://git-scm.com/
    pause
    exit /b 1
)

echo ✓ Git đã sẵn sàng
echo.

echo [2/3] Kiểm tra repository...
if not exist ".git" (
    echo ⚠ Chưa phải Git repository
    echo.
    echo Bạn có muốn khởi tạo Git repository? (Y/N)
    choice /C YN /N /M ""
    if errorlevel 2 exit /b 0
    if errorlevel 1 (
        echo.
        echo Đang khởi tạo Git repository...
        git init
        echo ✓ Đã khởi tạo
    )
)

echo.
echo [3/3] Tạo README.md...
if exist "README.md" (
    echo ℹ️  README.md đã tồn tại
) else (
    (
        echo # 93 Media Tool - Releases
        echo.
        echo Repository chứa các file installer cho auto-update.
    ) > README.md
    echo ✓ Đã tạo README.md
)

echo.
echo ========================================
echo ✅ Hoàn tất!
echo ========================================
echo.
echo 💡 Bước tiếp theo:
echo    1. Thêm remote (nếu chưa có):
echo       git remote add origin https://github.com/DungDT293/93-media-tool-releases.git
echo.
echo    2. Commit và push:
echo       git add README.md
echo       git commit -m "Initial commit"
echo       git push -u origin main
echo.
pause
