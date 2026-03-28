@echo off
chcp 65001 >nul
echo ========================================
echo    Check App Logs - Version 3.6.1
echo ========================================
echo.

set "LOG_FILE=%APPDATA%\93-media-tool-mix-nhac\logs\main.log"

echo [1/3] Kiểm tra log file...
if not exist "%LOG_FILE%" (
    echo ❌ Log file không tồn tại: %LOG_FILE%
    echo.
    echo 💡 Có thể app chưa chạy hoặc crash quá sớm
    pause
    exit /b 1
)
echo ✅ Log file tồn tại
echo.

echo [2/3] Kích thước log file:
for %%A in ("%LOG_FILE%") do echo    Size: %%~zA bytes
echo.

echo [3/3] Nội dung log (last 50 lines):
echo ========================================
powershell -Command "Get-Content '%LOG_FILE%' -Tail 50"
echo ========================================
echo.

echo 💡 Tìm kiếm lỗi:
powershell -Command "Get-Content '%LOG_FILE%' | Select-String -Pattern 'error|Error|ERROR|crash|Crash|failed|Failed|exception|Exception' -Context 2,2"
echo.

pause
