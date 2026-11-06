# PowerShell script to run migration with default ADMIN_TOKEN
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Run Migration Create Table auth_audit_logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Use default ADMIN_TOKEN (can be changed)
$adminToken = $env:ADMIN_TOKEN
if (-not $adminToken) {
    # Try default token from set-token-dung28072022.bat
    $adminToken = $env:ADMIN_TOKEN
    Write-Host "ADMIN_TOKEN not set, using default: <ADMIN_TOKEN>" -ForegroundColor Yellow
    Write-Host "If this token is incorrect, set it:" -ForegroundColor Yellow
    Write-Host "   `$env:ADMIN_TOKEN = 'your-actual-token'" -ForegroundColor Cyan
    Write-Host ""
}

$url = "https://license-server.dungdong333.workers.dev/api/migrate/v2"

Write-Host "[Step 1/2] Calling migration endpoint..." -ForegroundColor Yellow
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
        Write-Host "Migration successful!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Created:" -ForegroundColor Yellow
        Write-Host "   - Table auth_audit_logs with columns:" -ForegroundColor Cyan
        Write-Host "     * id (TEXT PRIMARY KEY)"
        Write-Host "     * username (TEXT NOT NULL)"
        Write-Host "     * event_type (TEXT NOT NULL)"
        Write-Host "     * severity (TEXT DEFAULT 'info')"
        Write-Host "     * ip_address (TEXT)"
        Write-Host "     * machine_id (TEXT)"
        Write-Host "     * details (TEXT)"
        Write-Host "     * timestamp (INTEGER NOT NULL)"
        Write-Host ""
        Write-Host "   - Indexes for better performance"
        Write-Host ""
        Write-Host "You can now check auth_audit_logs table in Cloudflare D1 Database Studio!" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "Migration failed!" -ForegroundColor Red
        Write-Host "Message: $($response.message)" -ForegroundColor Red
        Write-Host ""
    }
} catch {
    Write-Host ""
    Write-Host "Error calling migration endpoint!" -ForegroundColor Red
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
    Write-Host "Check:" -ForegroundColor Yellow
    Write-Host "   - Is ADMIN_TOKEN correct? (Current: $($adminToken.Substring(0, [Math]::Min(10, $adminToken.Length)))...)"
    Write-Host "   - Has server been deployed?"
    Write-Host "   - Is network connection OK?"
    Write-Host ""
    Write-Host "To set new ADMIN_TOKEN:" -ForegroundColor Cyan
    Write-Host "   `$env:ADMIN_TOKEN = 'your-token-here'" -ForegroundColor White
    Write-Host "   .\run-migration.ps1" -ForegroundColor White
    Write-Host ""
}

Read-Host "Press Enter to exit"
