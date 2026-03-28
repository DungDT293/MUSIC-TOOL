# Script: Upload Large File to R2 via S3 API
# Mục đích: Upload file lớn (>300 MB) lên R2 bucket qua S3 Compatibility API

param(
    [string]$Version = "",
    [string]$SourceDir = "dist-electron-output",
    [string]$BucketName = "license-updates-files"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📤 Upload Large File to R2 (S3 API)" -ForegroundColor Cyan
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

Write-Host "[1/4] Kiểm tra file installer..." -ForegroundColor Cyan
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
Write-Host "[2/4] Kiểm tra AWS CLI..." -ForegroundColor Cyan
try {
    $awsVersion = aws --version 2>&1
    Write-Host "✅ AWS CLI đã sẵn sàng: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS CLI chưa được cài đặt" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Cài đặt AWS CLI:" -ForegroundColor Yellow
    Write-Host "   1. Download: https://awscli.amazonaws.com/AWSCLIV2.msi" -ForegroundColor White
    Write-Host "   2. Install và restart terminal" -ForegroundColor White
    Write-Host "   3. Configure: aws configure" -ForegroundColor White
    Write-Host ""
    Write-Host "   Hoặc dùng cách khác: Upload qua Cloudflare Dashboard (chunked)" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "[3/4] Cấu hình S3 endpoint cho R2..." -ForegroundColor Cyan

# Get R2 account ID và endpoint từ Cloudflare
Write-Host "💡 Cần thông tin R2:" -ForegroundColor Yellow
Write-Host "   1. Vào Cloudflare Dashboard → R2 → license-updates-files" -ForegroundColor White
Write-Host "   2. Settings → S3 API" -ForegroundColor White
Write-Host "   3. Copy S3 API endpoint (ví dụ: https://4897ab...r2.cloudflarestorage.com)" -ForegroundColor White
Write-Host ""

$r2Endpoint = Read-Host "Nhập R2 S3 API endpoint"
if ([string]::IsNullOrEmpty($r2Endpoint)) {
    Write-Host "❌ Cần R2 endpoint để upload" -ForegroundColor Red
    exit 1
}

$accessKeyId = Read-Host "Nhập R2 Access Key ID (tạo trong Dashboard → R2 → Manage R2 API Tokens)"
$secretAccessKey = Read-Host "Nhập R2 Secret Access Key" -AsSecureString
$secretAccessKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretAccessKey)
)

Write-Host ""
Write-Host "[4/4] Upload file lên R2 (multipart)..." -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Thông tin upload:" -ForegroundColor Yellow
Write-Host "   Bucket: $BucketName" -ForegroundColor White
Write-Host "   Key: $R2Key" -ForegroundColor White
Write-Host "   File: $SourceFile" -ForegroundColor White
Write-Host "   Size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor White
Write-Host ""

# Set AWS credentials for this session
$env:AWS_ACCESS_KEY_ID = $accessKeyId
$env:AWS_SECRET_ACCESS_KEY = $secretAccessKeyPlain
$env:AWS_DEFAULT_REGION = "auto"

# Upload using S3 API with multipart
Write-Host "⏳ Đang upload (có thể mất vài phút)..." -ForegroundColor Yellow

$result = aws s3 cp "$SourceFile" "s3://$BucketName/$R2Key" `
    --endpoint-url "$r2Endpoint" `
    --no-verify-ssl 2>&1

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
    Write-Host "   https://license-updates-proxy.dungdong333.workers.dev/win/$InstallerName" -ForegroundColor White
    Write-Host ""
    Write-Host "💡 Bước tiếp theo:" -ForegroundColor Yellow
    Write-Host "   1. Test download file qua Worker URL" -ForegroundColor White
    Write-Host "   2. Upload latest.yml lên R2" -ForegroundColor White
    Write-Host "   3. Update version policy nếu cần" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Upload thất bại!" -ForegroundColor Red
    Write-Host "Error: $result" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Thử cách khác:" -ForegroundColor Yellow
    Write-Host "   - Upload qua Cloudflare Dashboard (chia nhỏ file)" -ForegroundColor White
    Write-Host "   - Hoặc dùng rclone với R2" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Clear credentials
Remove-Item Env:\AWS_ACCESS_KEY_ID
Remove-Item Env:\AWS_SECRET_ACCESS_KEY
Remove-Item Env:\AWS_DEFAULT_REGION
