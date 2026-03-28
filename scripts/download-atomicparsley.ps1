# Script tự động download AtomicParsley.exe
# Chạy: powershell -ExecutionPolicy Bypass -File scripts/download-atomicparsley.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Download AtomicParsley.exe" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Tạo folder bin nếu chưa có
$binPath = Join-Path $PSScriptRoot "..\bin"
if (-not (Test-Path $binPath)) {
    New-Item -ItemType Directory -Path $binPath | Out-Null
    Write-Host "✓ Đã tạo folder bin/" -ForegroundColor Green
}

$targetPath = Join-Path $binPath "AtomicParsley.exe"

# Kiểm tra đã có file chưa
if (Test-Path $targetPath) {
    Write-Host "⚠️  AtomicParsley.exe đã tồn tại tại: $targetPath" -ForegroundColor Yellow
    $overwrite = Read-Host "Bạn có muốn download lại? (y/n)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Bỏ qua download." -ForegroundColor Gray
        exit 0
    }
}

# GitHub API để lấy latest release
Write-Host "Đang lấy thông tin latest release từ GitHub..." -ForegroundColor Yellow
try {
    $apiUrl = "https://api.github.com/repos/wez/atomicparsley/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -Method Get
    
    # Tìm file Windows 64-bit
    $asset = $release.assets | Where-Object { 
        $_.name -like "*Windows*" -or 
        $_.name -like "*win*" -or 
        $_.name -like "*x64*" 
    } | Select-Object -First 1
    
    if (-not $asset) {
        # Fallback: tìm file .exe hoặc .zip
        $asset = $release.assets | Where-Object { 
            $_.name -like "*.exe" -or 
            $_.name -like "*.zip" 
        } | Select-Object -First 1
    }
    
    if (-not $asset) {
        throw "Không tìm thấy file download phù hợp"
    }
    
    $downloadUrl = $asset.browser_download_url
    $fileName = $asset.name
    
    Write-Host "✓ Tìm thấy: $fileName" -ForegroundColor Green
    Write-Host "  Version: $($release.tag_name)" -ForegroundColor Gray
    Write-Host "  Size: $([math]::Round($asset.size / 1MB, 2)) MB" -ForegroundColor Gray
    Write-Host ""
    
    # Download
    Write-Host "Đang download..." -ForegroundColor Yellow
    $tempFile = Join-Path $env:TEMP "AtomicParsley_$([guid]::NewGuid().ToString()).zip"
    
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
    
    Write-Host "✓ Download hoàn tất" -ForegroundColor Green
    Write-Host ""
    
    # Extract
    Write-Host "Đang giải nén..." -ForegroundColor Yellow
    $extractPath = Join-Path $env:TEMP "AtomicParsley_extract_$([guid]::NewGuid().ToString())"
    Expand-Archive -Path $tempFile -DestinationPath $extractPath -Force
    
    # Tìm file .exe trong extracted folder
    $exeFile = Get-ChildItem -Path $extractPath -Recurse -Filter "AtomicParsley.exe" | Select-Object -First 1
    
    if (-not $exeFile) {
        # Tìm file không có extension
        $exeFile = Get-ChildItem -Path $extractPath -Recurse -Filter "AtomicParsley" | Select-Object -First 1
    }
    
    if (-not $exeFile) {
        throw "Không tìm thấy AtomicParsley.exe trong file zip"
    }
    
    # Copy vào bin/
    Copy-Item -Path $exeFile.FullName -Destination $targetPath -Force
    
    Write-Host "✓ Đã copy vào: $targetPath" -ForegroundColor Green
    
    # Cleanup
    Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "✓ HOÀN TẤT!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "AtomicParsley.exe đã được đặt tại:" -ForegroundColor White
    Write-Host "  $targetPath" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Kiểm tra version:" -ForegroundColor Yellow
    Write-Host "  cd bin && AtomicParsley.exe --version" -ForegroundColor Gray
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "✗ LỖI: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Hướng dẫn download thủ công:" -ForegroundColor Yellow
    Write-Host "  1. Truy cập: https://github.com/wez/atomicparsley/releases/latest" -ForegroundColor Gray
    Write-Host "  2. Download file Windows 64-bit" -ForegroundColor Gray
    Write-Host "  3. Giải nén và copy AtomicParsley.exe vào folder bin/" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

