# Script: Auto Setup GitHub Releases
# Mục đích: Tự động update code với thông tin từ github-config.json

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 Setup GitHub Releases (Auto)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$configFile = "scripts/github-config.json"

if (-not (Test-Path $configFile)) {
    Write-Host "❌ Không tìm thấy file config: $configFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Tạo file config:" -ForegroundColor Yellow
    Write-Host "   1. Mở file: scripts/github-config.json" -ForegroundColor White
    Write-Host "   2. Điền GitHub username và repository name" -ForegroundColor White
    Write-Host "   3. Chạy lại script này" -ForegroundColor White
    exit 1
}

Write-Host "[1/3] Đọc thông tin từ config..." -ForegroundColor Cyan
$config = Get-Content $configFile -Raw | ConvertFrom-Json

$githubUsername = $config.github_username
$githubRepo = $config.github_repo

if ($githubUsername -eq "your-github-username" -or [string]::IsNullOrEmpty($githubUsername)) {
    Write-Host "❌ Chưa điền GitHub username trong config!" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Mở file: scripts/github-config.json" -ForegroundColor Yellow
    Write-Host "   Điền 'github_username' với username GitHub của bạn" -ForegroundColor White
    exit 1
}

Write-Host "✅ GitHub Username: $githubUsername" -ForegroundColor Green
Write-Host "✅ Repository: $githubRepo" -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] Đang update electron-builder.json5..." -ForegroundColor Cyan
$builderContent = Get-Content "electron-builder.json5" -Raw
$builderContent = $builderContent -replace "your-github-username", $githubUsername
$builderContent = $builderContent -replace "93-media-tool-releases", $githubRepo
$builderContent | Set-Content "electron-builder.json5" -NoNewline
Write-Host "✅ Đã update electron-builder.json5" -ForegroundColor Green

Write-Host ""
Write-Host "[3/3] Đang update electron/updater.ts..." -ForegroundColor Cyan
$updaterContent = Get-Content "electron/updater.ts" -Raw
$updaterContent = $updaterContent -replace "your-github-username", $githubUsername
$updaterContent = $updaterContent -replace "93-media-tool-releases", $githubRepo
$updaterContent | Set-Content "electron/updater.ts" -NoNewline
Write-Host "✅ Đã update electron/updater.ts" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Setup hoàn tất!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Thông tin đã cấu hình:" -ForegroundColor Yellow
Write-Host "   GitHub Username: $githubUsername" -ForegroundColor White
Write-Host "   Repository: $githubRepo" -ForegroundColor White
Write-Host ""
Write-Host "🔗 Repository URL:" -ForegroundColor Yellow
Write-Host "   https://github.com/$githubUsername/$githubRepo" -ForegroundColor White
Write-Host ""
Write-Host "💡 Bước tiếp theo:" -ForegroundColor Yellow
Write-Host "   1. Tạo repository trên GitHub (nếu chưa có):" -ForegroundColor White
Write-Host "      https://github.com/new" -ForegroundColor Gray
Write-Host "      Tên: $githubRepo" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Build va upload file:" -ForegroundColor White
Write-Host "      npm run build:win-installer" -ForegroundColor Gray
Write-Host "      Sau do upload file len GitHub Releases" -ForegroundColor Gray
Write-Host ""
Write-Host "   3. Xem hướng dẫn:" -ForegroundColor White
Write-Host "      docs/HUONG_DAN_GITHUB_RELEASES.md" -ForegroundColor Gray
Write-Host ""
