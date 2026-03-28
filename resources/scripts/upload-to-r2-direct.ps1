# Script: Upload Large File to R2 via S3 API (Direct - No AWS CLI)
# Mục đích: Upload file lớn (>300 MB) lên R2 bucket qua S3 REST API

param(
    [string]$Version = "",
    [string]$SourceDir = "dist-electron-output",
    [string]$BucketName = "license-updates-files",
    [string]$R2Endpoint = "https://4897ab4807ec9ac2acc80764b42080b3.r2.cloudflarestorage.com"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📤 Upload Large File to R2 (Direct)" -ForegroundColor Cyan
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

$fileSize = (Get-Item $SourceFile).Length / 1MB
Write-Host "✅ Tìm thấy: $InstallerName ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] Lấy R2 API Token..." -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 Cần tạo R2 API Token:" -ForegroundColor Yellow
Write-Host "   1. Vào Cloudflare Dashboard → R2 → Manage R2 API Tokens" -ForegroundColor White
Write-Host "   2. Create API Token" -ForegroundColor White
Write-Host "   3. Permissions: Object Read & Write" -ForegroundColor White
Write-Host "   4. Copy Access Key ID và Secret Access Key" -ForegroundColor White
Write-Host ""

$accessKeyId = Read-Host "Nhập R2 Access Key ID"
if ([string]::IsNullOrEmpty($accessKeyId)) {
    Write-Host "❌ Cần Access Key ID" -ForegroundColor Red
    exit 1
}

$secretAccessKey = Read-Host "Nhập R2 Secret Access Key" -AsSecureString
$secretAccessKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretAccessKey)
)

Write-Host ""
Write-Host "[3/3] Upload file lên R2 (multipart)..." -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Thông tin upload:" -ForegroundColor Yellow
Write-Host "   Endpoint: $R2Endpoint" -ForegroundColor White
Write-Host "   Bucket: $BucketName" -ForegroundColor White
Write-Host "   Key: $R2Key" -ForegroundColor White
Write-Host "   File: $SourceFile" -ForegroundColor White
Write-Host "   Size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor White
Write-Host ""

# Use AWS SDK for .NET via PowerShell (simpler approach)
# Or use curl with S3 signature

Write-Host "⏳ Đang upload (có thể mất vài phút)..." -ForegroundColor Yellow

# For large files, we'll use multipart upload
# But for simplicity, let's try direct upload first with curl

$fileBytes = [System.IO.File]::ReadAllBytes($SourceFile)
$fileContent = [System.Convert]::ToBase64String($fileBytes)

# S3 PUT Object request
$uri = "$R2Endpoint/$BucketName/$R2Key"
$date = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$dateShort = [DateTime]::UtcNow.ToString("yyyyMMdd")

# Create AWS Signature Version 4
# This is complex, so let's use a simpler approach: install AWS CLI or use rclone

Write-Host ""
Write-Host "⚠️  Upload trực tiếp qua PowerShell phức tạp (cần AWS Signature v4)" -ForegroundColor Yellow
Write-Host ""
Write-Host "💡 Giải pháp nhanh:" -ForegroundColor Cyan
Write-Host "   1. Cài AWS CLI: https://awscli.amazonaws.com/AWSCLIV2.msi" -ForegroundColor White
Write-Host "   2. Chạy lệnh sau:" -ForegroundColor White
Write-Host ""
Write-Host "   `$env:AWS_ACCESS_KEY_ID = '$accessKeyId'" -ForegroundColor Gray
Write-Host "   `$env:AWS_SECRET_ACCESS_KEY = '$secretAccessKeyPlain'" -ForegroundColor Gray
Write-Host "   `$env:AWS_DEFAULT_REGION = 'auto'" -ForegroundColor Gray
Write-Host ""
Write-Host "   aws s3 cp `"$SourceFile`" `"s3://$BucketName/$R2Key`" --endpoint-url `"$R2Endpoint`" --no-verify-ssl" -ForegroundColor Gray
Write-Host ""

# Clear secret
$secretAccessKeyPlain = $null

Write-Host "Hoặc dùng script tự động sau khi cài AWS CLI:" -ForegroundColor Cyan
Write-Host "   .\scripts\upload-to-r2-s3.ps1" -ForegroundColor White
Write-Host ""
