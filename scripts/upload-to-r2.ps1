# Script: Upload Installer to Cloudflare R2
# Mục đích: Upload file installer lên R2 bucket

param(
    [string]$Version = "",
    [string]$SourceDir = "dist-electron-output",
    [string]$BucketName = "license-updates-files"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📤 Upload Installer to Cloudflare R2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get version from package.json if not provided
if ([string]::IsNullOrEmpty($Version)) {
    $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
    $Version = $packageJson.version
    Write-Host "📦 Version từ package.json: $Version" -ForegroundColor Yellow
}

# File names
$InstallerName = "93 Media - Tool Mix Nhạc-Setup-$Version.exe"
$SourceFile = Join-Path $SourceDir $InstallerName
$R2Key = "win/$InstallerName"

Write-Host "[1/3] Kiểm tra file installer..." -ForegroundColor Cyan
if (-not (Test-Path $SourceFile)) {
    Write-Host "❌ Không tìm thấy file: $SourceFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Hãy build installer trước:" -ForegroundColor Yellow
    Write-Host "   npm run build:win-installer" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Tìm thấy: $InstallerName" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] Kiểm tra Wrangler CLI..." -ForegroundColor Cyan
try {
    $wranglerVersion = wrangler --version 2>&1
    Write-Host "✅ Wrangler CLI đã sẵn sàng: $wranglerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Wrangler CLI chưa được cài đặt" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Cài đặt Wrangler:" -ForegroundColor Yellow
    Write-Host "   npm install -g wrangler" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "[3/3] Upload file lên R2..." -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Thông tin upload:" -ForegroundColor Yellow
Write-Host "   Bucket: $BucketName" -ForegroundColor White
Write-Host "   Key: $R2Key" -ForegroundColor White
Write-Host "   File: $SourceFile" -ForegroundColor White
Write-Host ""

# Upload to R2
$escapedKey = $R2Key -replace ' ', '` '
$result = wrangler r2 object put "$BucketName/$R2Key" --file="$SourceFile" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "✅ Upload thành công!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📋 Thông tin:" -ForegroundColor Yellow
    Write-Host "   Bucket: $BucketName" -ForegroundColor White
    Write-Host "   Key: $R2Key" -ForegroundColor White
    Write-Host ""
    Write-Host "🔗 URL (qua Worker proxy):" -ForegroundColor Yellow
    Write-Host "   https://license-updates-proxy.{your-subdomain}.workers.dev/win/$InstallerName" -ForegroundColor White
    Write-Host ""
    Write-Host "💡 Bước tiếp theo:" -ForegroundColor Yellow
    Write-Host "   1. Upload latest.yml lên R2" -ForegroundColor White
    Write-Host "   2. Test download file qua Worker URL" -ForegroundColor White
    Write-Host "   3. Update version policy nếu cần" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Upload thất bại!" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Kiểm tra:" -ForegroundColor Yellow
    Write-Host "   - Đã login wrangler chưa? (wrangler login)" -ForegroundColor White
    Write-Host "   - Bucket đã được tạo chưa?" -ForegroundColor White
    Write-Host "   - Có quyền truy cập bucket không?" -ForegroundColor White
    Write-Host ""
    exit 1
}
