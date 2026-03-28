# PowerShell script de chay migration voi ADMIN_TOKEN mac dinh
# Encoding: UTF-8 with BOM
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Chay Migration Tao Bang auth_audit_logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Su dung ADMIN_TOKEN mac dinh (co the thay doi)
$adminToken = $env:ADMIN_TOKEN
if (-not $adminToken) {
    # Thu dung token mac dinh tu file set-token-dung28072022.bat
    $adminToken = "Dung28072022"
    Write-Host "ADMIN_TOKEN chua duoc set, su dung token mac dinh: Dung28072022" -ForegroundColor Yellow
    Write-Host "Neu token nay khong dung, hay set lai:" -ForegroundColor Yellow
    Write-Host "   `$env:ADMIN_TOKEN = 'your-actual-token'" -ForegroundColor Cyan
    Write-Host ""
}

# Trim whitespace to avoid issues
$adminToken = $adminToken.Trim()

$url = "https://license-server.dungdong333.workers.dev/api/migrate/v2"

Write-Host "[Buoc 1/2] Dang goi migration endpoint..." -ForegroundColor Yellow
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host "Token: $($adminToken.Substring(0, [Math]::Min(10, $adminToken.Length)))..." -ForegroundColor Gray
Write-Host "Token length: $($adminToken.Length)" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method POST -Headers @{
        "x-admin-token" = $adminToken
        "Content-Type" = "application/json"
    } -ErrorAction Stop

    Write-Host ""
    if ($response.success) {
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "Migration thanh cong!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Da tao:" -ForegroundColor Yellow
        Write-Host "   - Bang auth_audit_logs voi cac cot:" -ForegroundColor Cyan
        Write-Host "     * id (TEXT PRIMARY KEY)"
        Write-Host "     * username (TEXT NOT NULL)"
        Write-Host "     * event_type (TEXT NOT NULL)"
        Write-Host "     * severity (TEXT DEFAULT 'info')"
        Write-Host "     * ip_address (TEXT)"
        Write-Host "     * machine_id (TEXT)"
        Write-Host "     * details (TEXT)"
        Write-Host "     * timestamp (INTEGER NOT NULL)"
        Write-Host ""
        Write-Host "   - Indexes cho hieu suat tot hon"
        Write-Host ""
        Write-Host "Bay gio ban co the kiem tra bang auth_audit_logs trong Cloudflare D1 Database Studio!" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "Migration that bai!" -ForegroundColor Red
        Write-Host "Message: $($response.message)" -ForegroundColor Red
        Write-Host ""
    }
} catch {
    Write-Host ""
    Write-Host "Loi khi goi migration endpoint!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    
    if ($_.Exception.Response) {
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "Response: $responseBody" -ForegroundColor Red
        } catch {
            Write-Host "Khong the doc response body" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Kiem tra:" -ForegroundColor Yellow
    Write-Host "   - ADMIN_TOKEN co dung khong? (Hien tai: $($adminToken.Substring(0, [Math]::Min(10, $adminToken.Length)))...)"
    Write-Host "   - Server da duoc deploy chua?"
    Write-Host "   - Ket noi mang co on khong?"
    Write-Host ""
    Write-Host "De set ADMIN_TOKEN moi:" -ForegroundColor Cyan
    Write-Host "   `$env:ADMIN_TOKEN = 'your-token-here'" -ForegroundColor White
    Write-Host "   .\run-migration.ps1" -ForegroundColor White
    Write-Host ""
}

Read-Host "Nhan Enter de thoat"
