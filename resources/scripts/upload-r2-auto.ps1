# Upload file to R2 - Auto find file
$R2Endpoint = "https://4897ab4807ec9ac2acc80764b42080b3.r2.cloudflarestorage.com"
$BucketName = "license-updates-files"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Upload to R2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find installer file
$installerFile = Get-ChildItem "dist-electron-output" -Filter "*Setup-3.6.0.exe" | Select-Object -First 1

if (-not $installerFile) {
    Write-Host "File not found!" -ForegroundColor Red
    exit 1
}

$fileName = $installerFile.Name
$filePath = $installerFile.FullName
$fileSizeMB = [math]::Round($installerFile.Length / 1MB, 2)
$R2Key = "win/$fileName"

Write-Host "File: $fileName" -ForegroundColor Green
Write-Host "Size: $fileSizeMB MB" -ForegroundColor Green
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
    $null = aws --version 2>&1
    Write-Host "AWS CLI found" -ForegroundColor Green
} catch {
    Write-Host "AWS CLI not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install AWS CLI first:" -ForegroundColor Yellow
    Write-Host "Download: https://awscli.amazonaws.com/AWSCLIV2.msi" -ForegroundColor White
    Write-Host ""
    Write-Host "Then run these commands:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "`$env:AWS_ACCESS_KEY_ID = '$accessKeyId'" -ForegroundColor Gray
    Write-Host "`$env:AWS_SECRET_ACCESS_KEY = 'YOUR_SECRET'" -ForegroundColor Gray
    Write-Host "`$env:AWS_DEFAULT_REGION = 'auto'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "aws s3 cp `"$filePath`" `"s3://$BucketName/$R2Key`" --endpoint-url `"$R2Endpoint`" --no-verify-ssl" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Uploading (may take 5-10 minutes)..." -ForegroundColor Cyan

$env:AWS_ACCESS_KEY_ID = $accessKeyId
$env:AWS_SECRET_ACCESS_KEY = $secretPlain
$env:AWS_DEFAULT_REGION = "auto"

aws s3 cp "$filePath" "s3://$BucketName/$R2Key" --endpoint-url "$R2Endpoint" --no-verify-ssl

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS!" -ForegroundColor Green
    Write-Host "URL: https://license-updates-proxy.dungdong333.workers.dev/win/$fileName" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "FAILED!" -ForegroundColor Red
}

Remove-Item Env:\AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
Remove-Item Env:\AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\AWS_DEFAULT_REGION -ErrorAction SilentlyContinue
