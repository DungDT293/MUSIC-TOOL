# Diagnostic Script - Kiểm tra vấn đề app không hiển thị
# Chạy script này để kiểm tra các file và thư mục cần thiết

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "93 Media Tool - Diagnostic Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$errors = @()
$warnings = @()
$info = @()

# 1. Kiểm tra Installation Directory
Write-Host "[1] Kiem tra Installation Directory..." -ForegroundColor Yellow
$installDir = "$env:LOCALAPPDATA\Programs\93-media-tool-mix-nhac"
$foundInstallDir = $false

if (Test-Path $installDir) {
    Write-Host "    [OK] Tim thay: $installDir" -ForegroundColor Green
    $info += "Installation directory: $installDir"
    $foundInstallDir = $true
    
    # Kiểm tra file exe
    $exeFiles = Get-ChildItem -Path $installDir -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*93 Media*" -or $_.Name -like "*Tool Mix*" }
    if ($exeFiles.Count -gt 0) {
        Write-Host "    [OK] Tim thay $($exeFiles.Count) file exe" -ForegroundColor Green
        foreach ($exe in $exeFiles) {
            $info += "  - EXE: $($exe.FullName)"
        }
    } else {
        Write-Host "    [WARN] Khong tim thay file exe" -ForegroundColor Yellow
        $warnings += "Không tìm thấy file .exe trong installation directory"
    }
    
    # Kiểm tra thư mục dist
    $distDir = Join-Path $installDir "resources\app.asar.unpacked\dist"
    if (-not (Test-Path $distDir)) {
        $distDir = Join-Path $installDir "resources\app\dist"
    }
    if (Test-Path $distDir) {
        Write-Host "    [OK] Tim thay dist directory: $distDir" -ForegroundColor Green
        $info += "Dist directory: $distDir"
        
        # Kiểm tra index.html
        $indexHtml = Join-Path $distDir "index.html"
        if (Test-Path $indexHtml) {
            Write-Host "    [OK] Tim thay index.html" -ForegroundColor Green
            $info += "  - index.html: OK"
        } else {
            Write-Host "    [ERROR] Khong tim thay index.html!" -ForegroundColor Red
            $errors += "Không tìm thấy index.html tại: $indexHtml"
        }
        
        # Kiểm tra assets
        $assetsDir = Join-Path $distDir "assets"
        if (Test-Path $assetsDir) {
            $assetFiles = Get-ChildItem -Path $assetsDir -File -ErrorAction SilentlyContinue
            Write-Host "    [OK] Tim thay $($assetFiles.Count) file trong assets" -ForegroundColor Green
            $info += "  - Assets: $($assetFiles.Count) files"
        } else {
            Write-Host "    [WARN] Khong tim thay thư mục assets" -ForegroundColor Yellow
            $warnings += "Không tìm thấy thư mục assets"
        }
    } else {
        Write-Host "    [ERROR] Khong tim thay dist directory!" -ForegroundColor Red
        $errors += "Không tìm thấy dist directory tại: $distDir"
    }
    
    # Kiểm tra preload
    $preloadDir = Join-Path $installDir "resources\app.asar.unpacked\dist-electron\preload"
    if (-not (Test-Path $preloadDir)) {
        $preloadDir = Join-Path $installDir "resources\app\dist-electron\preload"
    }
    if (Test-Path $preloadDir) {
        $preloadFile = Join-Path $preloadDir "preload.js"
        if (Test-Path $preloadFile) {
            Write-Host "    [OK] Tim thay preload.js" -ForegroundColor Green
            $info += "  - preload.js: OK"
        } else {
            Write-Host "    [ERROR] Khong tim thay preload.js!" -ForegroundColor Red
            $errors += "Không tìm thấy preload.js tại: $preloadFile"
        }
    } else {
        Write-Host "    [WARN] Khong tim thay preload directory" -ForegroundColor Yellow
        $warnings += "Không tìm thấy preload directory"
    }
} else {
    Write-Host "    [WARN] Khong tim thay installation directory" -ForegroundColor Yellow
    Write-Host "    Co the ban dang dung portable version" -ForegroundColor Gray
    
    # Kiểm tra portable version - tìm exe trong các vị trí có thể
    $possiblePaths = @(
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Downloads",
        "$env:USERPROFILE\Documents",
        (Split-Path -Parent $MyInvocation.MyCommand.Path),
        (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
    )
    
    foreach ($searchPath in $possiblePaths) {
        if (Test-Path $searchPath) {
            $portableExe = Get-ChildItem -Path $searchPath -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { 
                $_.Name -like "*93 Media*" -or $_.Name -like "*Tool Mix*" 
            } | Select-Object -First 1
            
            if ($portableExe) {
                Write-Host "    [INFO] Tim thay portable executable: $($portableExe.FullName)" -ForegroundColor Green
                $info += "Portable executable: $($portableExe.FullName)"
                $foundInstallDir = $true
                
                # Kiểm tra thư mục resources/dist nếu có
                $portableDir = Split-Path -Parent $portableExe.FullName
                $portableDistDir = Join-Path $portableDir "resources\app.asar.unpacked\dist"
                if (-not (Test-Path $portableDistDir)) {
                    $portableDistDir = Join-Path $portableDir "resources\app\dist"
                }
                if (Test-Path $portableDistDir) {
                    $portableIndexHtml = Join-Path $portableDistDir "index.html"
                    if (Test-Path $portableIndexHtml) {
                        Write-Host "    [OK] Tim thay index.html trong portable version" -ForegroundColor Green
                        $info += "  - index.html (portable): OK"
                    }
                }
                break
            }
        }
    }
    
    if (-not $foundInstallDir) {
        $warnings += "Không tìm thấy installation directory tại: $installDir (có thể đang dùng portable version hoặc chưa cài đặt)"
    }
}

Write-Host ""

# 2. Kiểm tra UserData
Write-Host "[2] Kiem tra UserData..." -ForegroundColor Yellow
$userDataDir = "$env:APPDATA\93-media-tool-mix-nhac"
if (Test-Path $userDataDir) {
    Write-Host "    [OK] Tim thay UserData: $userDataDir" -ForegroundColor Green
    $info += "UserData directory: $userDataDir"
    
    # Kiểm tra logs
    $logsDir = Join-Path $userDataDir "logs"
    if (Test-Path $logsDir) {
        $logFiles = Get-ChildItem -Path $logsDir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
        if ($logFiles.Count -gt 0) {
            Write-Host "    [OK] Tim thay $($logFiles.Count) log files (hien thi 5 file moi nhat)" -ForegroundColor Green
            foreach ($log in $logFiles) {
                $info += "  - Log: $($log.Name) ($([math]::Round($log.Length/1KB, 2)) KB, $($log.LastWriteTime))"
            }
        }
    }
} else {
    Write-Host "    [INFO] UserData chua duoc tao (binh thuong neu chua chay app)" -ForegroundColor Gray
}

Write-Host ""

# 3. Kiểm tra ProgramData
Write-Host "[3] Kiem tra ProgramData..." -ForegroundColor Yellow
$programDataDir = "$env:PROGRAMDATA\93MediaToolMixNhac"
if (Test-Path $programDataDir) {
    Write-Host "    [OK] Tim thay ProgramData: $programDataDir" -ForegroundColor Green
    $info += "ProgramData directory: $programDataDir"
    
    # Kiểm tra authState.enc
    $authFile = Join-Path $programDataDir "authState.enc"
    if (Test-Path $authFile) {
        Write-Host "    [OK] Tim thay authState.enc" -ForegroundColor Green
        $info += "  - authState.enc: OK"
    } else {
        Write-Host "    [INFO] Khong tim thay authState.enc (binh thuong neu chua dang nhap)" -ForegroundColor Gray
    }
} else {
    Write-Host "    [INFO] ProgramData chua duoc tao (binh thuong neu chua chay app)" -ForegroundColor Gray
}

Write-Host ""

# 4. Kiểm tra Process đang chạy
Write-Host "[4] Kiem tra Process..." -ForegroundColor Yellow
$processes = Get-Process -Name "*93*", "*electron*" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "*93*" -or $_.ProcessName -like "*electron*" }
if ($processes.Count -gt 0) {
    Write-Host "    [WARN] Tim thay $($processes.Count) process dang chay:" -ForegroundColor Yellow
    foreach ($proc in $processes) {
        Write-Host "      - $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Yellow
        $warnings += "Process đang chạy: $($proc.ProcessName) (PID: $($proc.Id))"
    }
    Write-Host "    [INFO] Vui long dong tat ca process truoc khi chay lai app" -ForegroundColor Gray
} else {
    Write-Host "    [OK] Khong co process nao dang chay" -ForegroundColor Green
}

Write-Host ""

# 5. Kiểm tra Windows Event Log (nếu có lỗi gần đây)
Write-Host "[5] Kiem tra Windows Event Log..." -ForegroundColor Yellow
try {
    $events = Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='*93*','*electron*'} -MaxEvents 5 -ErrorAction SilentlyContinue
    if ($events) {
        Write-Host "    [INFO] Tim thay $($events.Count) event trong Event Log" -ForegroundColor Gray
        foreach ($event in $events) {
            $info += "  - Event: $($event.TimeCreated) - $($event.LevelDisplayName)"
        }
    } else {
        Write-Host "    [INFO] Khong tim thay event nao" -ForegroundColor Gray
    }
} catch {
    Write-Host "    [INFO] Khong the doc Event Log (co the can quyen Admin)" -ForegroundColor Gray
}

Write-Host ""

# Tổng kết
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TONG KET" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($errors.Count -gt 0) {
    Write-Host "[ERRORS] $($errors.Count) loi phat hien:" -ForegroundColor Red
    foreach ($err in $errors) {
        Write-Host "  - $err" -ForegroundColor Red
    }
    Write-Host ""
}

if ($warnings.Count -gt 0) {
    Write-Host "[WARNINGS] $($warnings.Count) canh bao:" -ForegroundColor Yellow
    foreach ($warn in $warnings) {
        Write-Host "  - $warn" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($info.Count -gt 0) {
    Write-Host "[INFO] Thong tin:" -ForegroundColor Green
    foreach ($inf in $info) {
        Write-Host "  - $inf" -ForegroundColor Gray
    }
    Write-Host ""
}

# Đề xuất giải pháp
if ($errors.Count -gt 0) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "DE XUAT GIAI PHAP" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Chay uninstaller de xoa sach:" -ForegroundColor Yellow
    Write-Host "   .\scripts\uninstall-complete.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Cai dat lai ung dung" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "3. Neu van loi, kiem tra:" -ForegroundColor Yellow
    Write-Host "   - Antivirus co chan file khong" -ForegroundColor White
    Write-Host "   - Quyen Administrator" -ForegroundColor White
    Write-Host "   - Windows Firewall" -ForegroundColor White
    Write-Host ""
}

Write-Host "Nhan phim bat ky de thoat..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
























































































