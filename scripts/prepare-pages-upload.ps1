# Script: Prepare Files for Cloudflare Pages Upload
# Mục đích: Tạo thư mục và copy file installer để upload lên Cloudflare Pages

param(
    [string]$Version = "",
    [string]$SourceDir = "dist-electron-output",
    [string]$OutputDir = "C:\temp\pages-upload"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📤 Prepare Files for Cloudflare Pages Upload" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get version from package.json if not provided
if ([string]::IsNullOrEmpty($Version)) {
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    $Version = $packageJson.version
    Write-Host "📦 Version từ package.json: $Version" -ForegroundColor Yellow
}

# File names
$InstallerName = "93 Media - Tool Mix Nhạc-Setup-$Version.exe"
$SourceFile = Join-Path $SourceDir $InstallerName
$WinDir = Join-Path $OutputDir "win"
$TargetFile = Join-Path $WinDir $InstallerName

Write-Host "[1/4] Kiểm tra file installer..." -ForegroundColor Cyan
if (-not (Test-Path $SourceFile)) {
    Write-Host "❌ Không tìm thấy file: $SourceFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Hãy build installer trước:" -ForegroundColor Yellow
    Write-Host "   npm run build:win-installer" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Tìm thấy: $InstallerName" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Tạo thư mục output..." -ForegroundColor Cyan
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "✅ Đã tạo: $OutputDir" -ForegroundColor Green
} else {
    Write-Host "✅ Thư mục đã tồn tại: $OutputDir" -ForegroundColor Green
}

if (-not (Test-Path $WinDir)) {
    New-Item -ItemType Directory -Path $WinDir -Force | Out-Null
    Write-Host "✅ Đã tạo: $WinDir" -ForegroundColor Green
} else {
    Write-Host "✅ Thư mục đã tồn tại: $WinDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "[3/4] Copy file installer..." -ForegroundColor Cyan
Copy-Item -Path $SourceFile -Destination $TargetFile -Force
Write-Host "✅ Đã copy: $InstallerName" -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] Kiểm tra file cũ (nếu có)..." -ForegroundColor Cyan
$OldFiles = Get-ChildItem -Path $WinDir -Filter "*.exe" | Where-Object { $_.Name -ne $InstallerName }
if ($OldFiles.Count -gt 0) {
    Write-Host "📋 Tìm thấy $($OldFiles.Count) file cũ:" -ForegroundColor Yellow
    foreach ($file in $OldFiles) {
        Write-Host "   - $($file.Name)" -ForegroundColor Gray
    }
    Write-Host "✅ Giữ lại file cũ để users có thể download" -ForegroundColor Green
} else {
    Write-Host "ℹ️  Không có file cũ (đây là lần upload đầu tiên)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Hoàn tất!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📁 Thư mục sẵn sàng upload:" -ForegroundColor Yellow
Write-Host "   $WinDir" -ForegroundColor White
Write-Host ""
Write-Host "📋 Các bước tiếp theo:" -ForegroundColor Yellow
Write-Host "   1. Vào Cloudflare Dashboard: https://dash.cloudflare.com" -ForegroundColor White
Write-Host "   2. Workers & Pages → license-updates → Deployments" -ForegroundColor White
Write-Host "   3. Create deployment → Drag & drop thư mục 'win' vào" -ForegroundColor White
Write-Host "   4. Click Deploy" -ForegroundColor White
Write-Host ""
Write-Host "🔗 URL sau khi upload:" -ForegroundColor Yellow
Write-Host "   https://license-updates.pages.dev/win/$InstallerName" -ForegroundColor White
Write-Host ""
Write-Host "📖 Xem hướng dẫn chi tiết: docs/HUONG_DAN_UPLOAD_INSTALLER_CHI_TIET.md" -ForegroundColor Cyan
Write-Host ""
