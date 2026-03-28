@echo off
REM Script: Upload Installer to GitHub Releases
REM Mục đích: Upload file installer lên GitHub Releases (thủ công)

setlocal enabledelayedexpansion

echo ========================================
echo 📤 Upload Installer to GitHub Releases
echo ========================================
echo.

REM Get version from package.json
for /f "tokens=2 delims=:," %%a in ('findstr "version" package.json') do (
    set VERSION=%%a
    set VERSION=!VERSION:"=!
    set VERSION=!VERSION: =!
)

echo 📦 Version: %VERSION%
echo.

REM File names
set INSTALLER_NAME=93 Media - Tool Mix Nhạc-Setup-%VERSION%.exe
set SOURCE_FILE=dist-electron-output\%INSTALLER_NAME%

echo [1/3] Kiểm tra file installer...
if not exist "%SOURCE_FILE%" (
    echo ❌ Không tìm thấy file: %SOURCE_FILE%
    echo.
    echo 💡 Hãy build installer trước:
    echo    npm run build:win-installer
    exit /b 1
)
echo ✅ Tìm thấy: %INSTALLER_NAME%
echo.

echo [2/3] Kiểm tra GitHub CLI...
where gh >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ GitHub CLI chưa được cài đặt
    echo.
    echo 💡 Cài đặt GitHub CLI:
    echo    Download: https://cli.github.com/
    echo    Hoặc: winget install GitHub.cli
    echo.
    echo 💡 Hoặc upload thủ công qua GitHub Web:
    echo    1. Vào repository trên GitHub
    echo    2. Releases → Create a new release
    echo    3. Tag: v%VERSION%
    echo    4. Upload file: %INSTALLER_NAME%
    exit /b 1
)
echo ✅ GitHub CLI đã sẵn sàng
echo.

echo [3/3] Upload file lên GitHub Releases...
echo.
echo 📋 Thông tin upload:
echo    Tag: v%VERSION%
echo    File: %INSTALLER_NAME%
echo.

REM Check if release exists
gh release view v%VERSION% >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ℹ️  Release v%VERSION% đã tồn tại, sẽ upload file mới...
    gh release upload v%VERSION% "%SOURCE_FILE%" --clobber
) else (
    echo ℹ️  Tạo release mới v%VERSION%...
    gh release create v%VERSION% "%SOURCE_FILE%" --title "Version %VERSION%" --notes "Release version %VERSION%"
)

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ Upload thành công!
    echo ========================================
    echo.
    echo 🔗 URL:
    echo    https://github.com/{your-username}/{your-repo}/releases/tag/v%VERSION%
    echo.
    echo 💡 Bước tiếp theo:
    echo    1. Update version policy trong dashboard
    echo    2. Test download file từ GitHub Releases
    echo.
) else (
    echo.
    echo ❌ Upload thất bại!
    echo.
    echo 💡 Kiểm tra:
    echo    - Đã login GitHub CLI chưa? (gh auth login)
    echo    - Repository có đúng không?
    echo    - Có quyền upload không?
    echo.
    exit /b 1
)

pause
