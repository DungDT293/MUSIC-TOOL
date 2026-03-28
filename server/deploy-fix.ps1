# PowerShell script để deploy server code
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 Deploy Server Code Lên Cloudflare Workers" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# Set API Token
$env:CLOUDFLARE_API_TOKEN = "ilJo9lCFk4VV7qbdC5WgkjJYTVF6y4xF3Le26Ied"

Write-Host "[Bước 1/2] Kiểm tra Wrangler..." -ForegroundColor Yellow
$wranglerVersion = npx wrangler --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Wrangler không tìm thấy. Đang cài đặt..." -ForegroundColor Red
    npm install -g wrangler
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Không thể cài đặt wrangler!" -ForegroundColor Red
        Read-Host "Nhấn Enter để thoát"
        exit 1
    }
}

Write-Host ""
Write-Host "[Bước 2/2] Đang deploy lên Cloudflare Workers..." -ForegroundColor Yellow
Write-Host ""

npx wrangler deploy

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✅ Deploy thành công!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Server URL: https://license-server.dungdong333.workers.dev" -ForegroundColor Cyan
    Write-Host "📋 Dashboard: https://license-server.dungdong333.workers.dev/dashboard" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📝 Đã sửa các vấn đề:" -ForegroundColor Yellow
    Write-Host "   - Fix request body double-reading issue"
    Write-Host "   - Add comprehensive error handling"
    Write-Host ""
    Write-Host "✅ Bây giờ bạn có thể test lại đăng ký từ client app!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Deploy thất bại!" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Nếu lỗi về token, hãy thử:" -ForegroundColor Yellow
    Write-Host "   1. Chạy: npx wrangler login"
    Write-Host "   2. Hoặc tạo token mới tại: https://dash.cloudflare.com/profile/api-tokens"
    Write-Host ""
}

Read-Host "Nhấn Enter để thoát"
