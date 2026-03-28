@echo off
echo ========================================
echo Deploy Version Policy Update to Cloudflare
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Wrangler...
npx wrangler --version

echo.
echo [2/3] Deploying to Cloudflare Workers...
npx wrangler deploy

echo.
echo [3/3] Done!
echo.
echo Dashboard URL: https://license-server.dungdong333.workers.dev/dashboard
echo.
echo Please check the dashboard to see the new "Quan Ly Phien Ban" tab.
echo.
pause
