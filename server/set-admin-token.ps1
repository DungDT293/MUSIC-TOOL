# PowerShell script to set ADMIN_TOKEN in Cloudflare Workers
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Set ADMIN_TOKEN in Cloudflare Workers" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if CLOUDFLARE_API_TOKEN is set
if (-not $env:CLOUDFLARE_API_TOKEN) {
    Write-Host "Setting CLOUDFLARE_API_TOKEN..." -ForegroundColor Yellow
    $env:CLOUDFLARE_API_TOKEN = $env:CLOUDFLARE_API_TOKEN
}

# Default ADMIN_TOKEN
$defaultToken = $env:ADMIN_TOKEN

Write-Host "This script will help you set ADMIN_TOKEN." -ForegroundColor Yellow
Write-Host ""
Write-Host "ADMIN_TOKEN to set: $defaultToken" -ForegroundColor Cyan
Write-Host ""
Write-Host "Method 1: Interactive (recommended)" -ForegroundColor Green
Write-Host "   Run: npx wrangler secret put ADMIN_TOKEN" -ForegroundColor White
Write-Host "   When prompted, enter: $defaultToken" -ForegroundColor White
Write-Host ""
Write-Host "Method 2: Using this script" -ForegroundColor Green
Write-Host "   The script will attempt to set it automatically..." -ForegroundColor White
Write-Host ""
Write-Host "Press Enter to continue with Method 2, or Ctrl+C to use Method 1..." -ForegroundColor Cyan
Read-Host

Write-Host ""
Write-Host "[Setting ADMIN_TOKEN...]" -ForegroundColor Yellow
Write-Host ""

try {
    # Try using stdin redirection
    $defaultToken | npx wrangler secret put ADMIN_TOKEN 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "ADMIN_TOKEN set successfully!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Token: $defaultToken" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Now you can run migration:" -ForegroundColor Yellow
        Write-Host "   `$env:ADMIN_TOKEN = '$defaultToken'" -ForegroundColor White
        Write-Host "   .\run-migration.ps1" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "Automatic method failed. Please use Method 1:" -ForegroundColor Yellow
        Write-Host "   1. Run: npx wrangler secret put ADMIN_TOKEN" -ForegroundColor White
        Write-Host "   2. When prompted, enter: $defaultToken" -ForegroundColor White
        Write-Host "   3. Then run: .\run-migration.ps1" -ForegroundColor White
        Write-Host ""
    }
} catch {
    Write-Host ""
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please use Method 1 (interactive):" -ForegroundColor Yellow
    Write-Host "   npx wrangler secret put ADMIN_TOKEN" -ForegroundColor White
    Write-Host "   (Enter: $defaultToken)" -ForegroundColor White
    Write-Host ""
}

Read-Host "Press Enter to exit"
