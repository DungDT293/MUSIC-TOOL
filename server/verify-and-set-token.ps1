# PowerShell script to verify and set ADMIN_TOKEN
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verify ADMIN_TOKEN Secret" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set Cloudflare API token
if (-not $env:CLOUDFLARE_API_TOKEN) {
    $env:CLOUDFLARE_API_TOKEN = "ilJo9lCFk4VV7qbdC5WgkjJYTVF6y4xF3Le26Ied"
}

$expectedToken = "Dung28072022"

Write-Host "Expected token: $expectedToken" -ForegroundColor Yellow
Write-Host "Token length: $($expectedToken.Length)" -ForegroundColor Yellow
Write-Host ""

Write-Host "[Step 1] Listing current secrets..." -ForegroundColor Cyan
npx wrangler secret list

Write-Host ""
Write-Host "[Step 2] Setting ADMIN_TOKEN again..." -ForegroundColor Cyan
Write-Host "This will ensure the secret is properly set." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Enter to continue, or Ctrl+C to cancel..." -ForegroundColor Yellow
Read-Host

Write-Host ""
Write-Host "When prompted, enter: $expectedToken" -ForegroundColor Cyan
Write-Host ""

# Use a here-string to pipe the token
$expectedToken | npx wrangler secret put ADMIN_TOKEN

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Secret set successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Waiting 5 seconds for secret to propagate..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    Write-Host ""
    Write-Host "Now try running migration:" -ForegroundColor Cyan
    Write-Host "   `$env:ADMIN_TOKEN = '$expectedToken'" -ForegroundColor White
    Write-Host "   .\run-migration.ps1" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "Failed to set secret. Please try manually:" -ForegroundColor Red
    Write-Host "   npx wrangler secret put ADMIN_TOKEN" -ForegroundColor White
    Write-Host "   (Enter: $expectedToken)" -ForegroundColor White
    Write-Host ""
}

Read-Host "Press Enter to exit"
