# PowerShell script to automatically set token, deploy, and run migration
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Auto Migration Setup and Run" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set Cloudflare API token
$env:CLOUDFLARE_API_TOKEN = "ilJo9lCFk4VV7qbdC5WgkjJYTVF6y4xF3Le26Ied"
$adminToken = "Dung28072022"

Write-Host "Step 1: Setting ADMIN_TOKEN secret..." -ForegroundColor Yellow
Write-Host "Token: $adminToken" -ForegroundColor Gray
Write-Host ""

try {
    # Set the secret
    $adminToken | npx wrangler secret put ADMIN_TOKEN 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Secret set successfully" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Failed to set secret (exit code: $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "Please set manually: npx wrangler secret put ADMIN_TOKEN" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "[ERROR] Error setting secret: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Waiting 3 seconds for secret to propagate..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Step 3: Deploying server to ensure secret is loaded..." -ForegroundColor Yellow
Write-Host ""

try {
    npx wrangler deploy 2>&1 | Tee-Object -Variable deployOutput
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[OK] Server deployed successfully" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[FAIL] Deployment failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "Deploy output:" -ForegroundColor Yellow
        Write-Host $deployOutput -ForegroundColor Gray
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "[ERROR] Error deploying: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 4: Waiting 5 seconds for deployment to complete..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Step 5: Running migration..." -ForegroundColor Yellow
Write-Host ""

$env:ADMIN_TOKEN = $adminToken
$url = "https://license-server.dungdong333.workers.dev/api/migrate/v2"

Write-Host "URL: $url" -ForegroundColor Gray
Write-Host "Token: $($adminToken.Substring(0, [Math]::Min(10, $adminToken.Length)))..." -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method POST -Headers @{
        "x-admin-token" = $adminToken
        "Content-Type" = "application/json"
    } -ErrorAction Stop

    Write-Host ""
    if ($response.success) {
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "[OK] Migration successful!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Created:" -ForegroundColor Yellow
        Write-Host "   - Table auth_audit_logs with columns:" -ForegroundColor Cyan
        Write-Host "     * id, username, event_type, severity"
        Write-Host "     * ip_address, machine_id, details, timestamp"
        Write-Host ""
        Write-Host "   - Indexes for better performance"
        Write-Host ""
        Write-Host "You can now check auth_audit_logs table in Cloudflare D1 Database Studio!" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "[FAIL] Migration failed!" -ForegroundColor Red
        Write-Host "Message: $($response.message)" -ForegroundColor Red
        Write-Host ""
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "[ERROR] Error running migration!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    
    if ($_.Exception.Response) {
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "Response: $responseBody" -ForegroundColor Red
        } catch {
            Write-Host "Cannot read response body" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   - Check if ADMIN_TOKEN matches the secret on Cloudflare"
    Write-Host "   - Verify server is deployed and running"
    Write-Host "   - Check network connection"
    Write-Host ""
    exit 1
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "All steps completed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
