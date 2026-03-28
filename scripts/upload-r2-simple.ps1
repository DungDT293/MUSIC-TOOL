# Upload file to R2 using AWS CLI
# Endpoint: https://4897ab4807ec9ac2acc80764b42080b3.r2.cloudflarestorage.com

param(
    [string]$Version = "3.6.0",
    [string]$BucketName = "license-updates-files",
    [string]$R2Endpoint = "https://4897ab4807ec9ac2acc80764b42080b3.r2.cloudflarestorage.com"
)

$InstallerName = "93 Media - Tool Mix Nhạc-Setup-$Version.exe"
$SourceFile = "dist-electron-output\$InstallerName"
$R2Key = "win/$InstallerName"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Upload to R2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $SourceFile)) {
    Write-Host "File not found: $SourceFile" -ForegroundColor Red
    exit 1
}

Write-Host "File: $InstallerName" -ForegroundColor Green
Write-Host "Size: $([math]::Round((Get-Item $SourceFile).Length / 1MB, 2)) MB" -ForegroundColor Green
Write-Host ""

Write-Host "Need R2 API Token:" -ForegroundColor Yellow
Write-Host "1. Cloudflare Dashboard -> R2 -> Manage R2 API Tokens" -ForegroundColor White
Write-Host "2. Create API Token (Object Read & Write)" -ForegroundColor White
Write-Host ""

$accessKeyId = Read-Host "Access Key ID"
$secretAccessKey = Read-Host "Secret Access Key" -AsSecureString
$secretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretAccessKey)
)

Write-Host ""
Write-Host "Checking AWS CLI..." -ForegroundColor Cyan

try {
    $awsVer = aws --version 2>&1
    Write-Host "AWS CLI found: $awsVer" -ForegroundColor Green
} catch {
    Write-Host "AWS CLI not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install AWS CLI:" -ForegroundColor Yellow
    Write-Host "Download: https://awscli.amazonaws.com/AWSCLIV2.msi" -ForegroundColor White
    Write-Host ""
    Write-Host "Or use this command after installing:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host '$env:AWS_ACCESS_KEY_ID = "' + $accessKeyId + '"' -ForegroundColor Gray
    Write-Host '$env:AWS_SECRET_ACCESS_KEY = "YOUR_SECRET"' -ForegroundColor Gray
    Write-Host '$env:AWS_DEFAULT_REGION = "auto"' -ForegroundColor Gray
    Write-Host ""
    Write-Host "aws s3 cp `"$SourceFile`" `"s3://$BucketName/$R2Key`" --endpoint-url `"$R2Endpoint`" --no-verify-ssl" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Uploading..." -ForegroundColor Cyan

$env:AWS_ACCESS_KEY_ID = $accessKeyId
$env:AWS_SECRET_ACCESS_KEY = $secretPlain
$env:AWS_DEFAULT_REGION = "auto"

aws s3 cp "$SourceFile" "s3://$BucketName/$R2Key" --endpoint-url "$R2Endpoint" --no-verify-ssl

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS!" -ForegroundColor Green
    Write-Host "URL: https://license-updates-proxy.dungdong333.workers.dev/win/$InstallerName" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "FAILED!" -ForegroundColor Red
}

Remove-Item Env:\AWS_ACCESS_KEY_ID
Remove-Item Env:\AWS_SECRET_ACCESS_KEY
Remove-Item Env:\AWS_DEFAULT_REGION
