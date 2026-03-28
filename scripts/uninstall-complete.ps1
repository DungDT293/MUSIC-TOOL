# Uninstaller Script - Xóa sạch sẽ 93 Media Tool Mix Nhạc
# Chạy với quyền Administrator để xóa hoàn toàn

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "93 Media Tool Mix Nhac - Uninstaller" -ForegroundColor Cyan
Write-Host "Version 1.3.6 - Xoa Sach Chuyen Sau" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Kiểm tra quyền Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[WARNING] Script chua chay voi quyen Administrator!" -ForegroundColor Yellow
    Write-Host "[WARNING] Mot so thu muc co the khong xoa duoc." -ForegroundColor Yellow
    Write-Host "[WARNING] Vui long chay lai voi quyen Administrator de xoa hoan toan." -ForegroundColor Yellow
    Write-Host ""
}

# Đóng tất cả processes liên quan trước khi xóa
Write-Host "[INFO] Dang kiem tra va dong cac process lien quan..." -ForegroundColor Cyan
$processes = Get-Process -Name "*93*", "*electron*" -ErrorAction SilentlyContinue | Where-Object { 
    $_.ProcessName -like "*93*" -or $_.ProcessName -like "*electron*" -or $_.MainWindowTitle -like "*93 Media*"
}
if ($processes.Count -gt 0) {
    Write-Host "[WARNING] Tim thay $($processes.Count) process dang chay:" -ForegroundColor Yellow
    foreach ($proc in $processes) {
        Write-Host "  - $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Yellow
        try {
            Stop-Process -Id $proc.Id -Force -ErrorAction Stop
            Write-Host "    [OK] Da dong process $($proc.ProcessName)" -ForegroundColor Green
        } catch {
            Write-Host "    [FAIL] Khong the dong process $($proc.ProcessName): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    Start-Sleep -Seconds 2
} else {
    Write-Host "[OK] Khong co process nao dang chay" -ForegroundColor Green
}
Write-Host ""

# Danh sách các thư mục/file cần xóa
$pathsToDelete = @()

# 1. Electron UserData (AppData\Roaming)
$appDataRoaming = "$env:APPDATA\93-media-tool-mix-nhac"
if (Test-Path $appDataRoaming) {
    $pathsToDelete += $appDataRoaming
    Write-Host "[1] Tim thay UserData: $appDataRoaming" -ForegroundColor Green
} else {
    Write-Host "[1] Khong tim thay UserData" -ForegroundColor Gray
}

# 2. ProgramData (C:\ProgramData\93MediaToolMixNhac)
$programData = "$env:PROGRAMDATA\93MediaToolMixNhac"
if (Test-Path $programData) {
    $pathsToDelete += $programData
    Write-Host "[2] Tim thay ProgramData: $programData" -ForegroundColor Green
} else {
    Write-Host "[2] Khong tim thay ProgramData" -ForegroundColor Gray
}

# 3. Home directory (.93-media-tool-mix-nhac)
$homeDir = "$env:USERPROFILE\.93-media-tool-mix-nhac"
if (Test-Path $homeDir) {
    $pathsToDelete += $homeDir
    Write-Host "[3] Tim thay Home directory: $homeDir" -ForegroundColor Green
} else {
    Write-Host "[3] Khong tim thay Home directory" -ForegroundColor Gray
}

# 4. Installation directory (AppData\Local\Programs)
$installDir = "$env:LOCALAPPDATA\Programs\93-media-tool-mix-nhac"
if (Test-Path $installDir) {
    $pathsToDelete += $installDir
    Write-Host "[4] Tim thay Installation directory: $installDir" -ForegroundColor Green
} else {
    Write-Host "[4] Khong tim thay Installation directory" -ForegroundColor Gray
}

# 5. Desktop shortcut
$desktopShortcut = "$env:PUBLIC\Desktop\93 Media Tool.lnk"
if (Test-Path $desktopShortcut) {
    $pathsToDelete += $desktopShortcut
    Write-Host "[5] Tim thay Desktop shortcut: $desktopShortcut" -ForegroundColor Green
} else {
    Write-Host "[5] Khong tim thay Desktop shortcut" -ForegroundColor Gray
}

# 6. Start Menu shortcut
$startMenuShortcut = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\93 Media Tool.lnk"
if (Test-Path $startMenuShortcut) {
    $pathsToDelete += $startMenuShortcut
    Write-Host "[6] Tim thay Start Menu shortcut: $startMenuShortcut" -ForegroundColor Green
} else {
    Write-Host "[6] Khong tim thay Start Menu shortcut" -ForegroundColor Gray
}

# 7. AppData\Local\93-media-tool-mix-nhac (nếu có)
$appDataLocal = "$env:LOCALAPPDATA\93-media-tool-mix-nhac"
if (Test-Path $appDataLocal) {
    $pathsToDelete += $appDataLocal
    Write-Host "[7] Tim thay AppData Local: $appDataLocal" -ForegroundColor Green
} else {
    Write-Host "[7] Khong tim thay AppData Local" -ForegroundColor Gray
}

# 8. Start Menu folder (toàn bộ thư mục)
$startMenuFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\93 Media Tool"
if (Test-Path $startMenuFolder) {
    $pathsToDelete += $startMenuFolder
    Write-Host "[8] Tim thay Start Menu folder: $startMenuFolder" -ForegroundColor Green
} else {
    Write-Host "[8] Khong tim thay Start Menu folder" -ForegroundColor Gray
}

# 9. Temp files và cache
$tempPaths = @(
    "$env:TEMP\93-media-tool-mix-nhac*",
    "$env:TEMP\*93*Media*",
    "$env:LOCALAPPDATA\Temp\93-media-tool-mix-nhac*"
)
foreach ($tempPattern in $tempPaths) {
    $tempFiles = Get-ChildItem -Path (Split-Path $tempPattern) -Filter (Split-Path -Leaf $tempPattern) -ErrorAction SilentlyContinue
    if ($tempFiles) {
        foreach ($tempFile in $tempFiles) {
            $pathsToDelete += $tempFile.FullName
            Write-Host "[9] Tim thay temp file: $($tempFile.FullName)" -ForegroundColor Green
        }
    }
}

# 10. Registry entries (nếu có quyền Admin)
if ($isAdmin) {
    Write-Host "[10] Kiem tra Registry entries..." -ForegroundColor Yellow
    $registryPaths = @(
        "HKCU:\Software\93-media-tool-mix-nhac",
        "HKLM:\Software\93-media-tool-mix-nhac",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\93-media-tool-mix-nhac",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\93-media-tool-mix-nhac"
    )
    foreach ($regPath in $registryPaths) {
        if (Test-Path $regPath) {
            Write-Host "    Tim thay Registry key: $regPath" -ForegroundColor Green
            try {
                Remove-Item -Path $regPath -Recurse -Force -ErrorAction Stop
                Write-Host "    [OK] Da xoa Registry key: $regPath" -ForegroundColor Green
            } catch {
                Write-Host "    [FAIL] Khong the xoa Registry key: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
} else {
    Write-Host "[10] Bo qua Registry (can quyen Admin)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Tong cong: $($pathsToDelete.Count) thu muc/file se bi xoa" -ForegroundColor Yellow
Write-Host ""

# Xác nhận
$confirm = Read-Host "Ban co chac muon xoa tat ca? (Y/N)"
if ($confirm -ne "Y" -and $confirm -ne "y") {
    Write-Host "Huy bo." -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "Bat dau xoa..." -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$failCount = 0

foreach ($path in $pathsToDelete) {
    try {
        if (Test-Path $path) {
            $item = Get-Item $path -ErrorAction Stop
            
            # Nếu là file đang được sử dụng, thử unlock trước
            if ($item -is [System.IO.FileInfo]) {
                try {
                    $fileStream = [System.IO.File]::Open($path, 'Open', 'ReadWrite', 'None')
                    $fileStream.Close()
                } catch {
                    # File đang được sử dụng, thử đợi và retry
                    Write-Host "[INFO] File dang duoc su dung, cho 2 giay..." -ForegroundColor Yellow
                    Start-Sleep -Seconds 2
                }
            }
            
            # Xóa với retry logic
            $maxRetries = 3
            $retryCount = 0
            $deleted = $false
            
            while ($retryCount -lt $maxRetries -and -not $deleted) {
                try {
                    if ($item -is [System.IO.DirectoryInfo]) {
                        Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
                        Write-Host "[OK] Xoa thu muc: $path" -ForegroundColor Green
                    } else {
                        Remove-Item -Path $path -Force -ErrorAction Stop
                        Write-Host "[OK] Xoa file: $path" -ForegroundColor Green
                    }
                    $deleted = $true
                    $successCount++
                } catch {
                    $retryCount++
                    if ($retryCount -lt $maxRetries) {
                        Write-Host "[RETRY] Thu lai lan $retryCount/$maxRetries..." -ForegroundColor Yellow
                        Start-Sleep -Seconds 1
                    } else {
                        throw
                    }
                }
            }
        }
    } catch {
        Write-Host "[FAIL] Khong the xoa: $path" -ForegroundColor Red
        Write-Host "       Error: $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
        
        # Gợi ý giải pháp
        if ($_.Exception.Message -like "*being used*" -or $_.Exception.Message -like "*dang duoc su dung*") {
            Write-Host "       [TIP] File/thu muc dang duoc su dung. Vui long dong tat ca ung dung lien quan." -ForegroundColor Yellow
        } elseif ($_.Exception.Message -like "*access denied*" -or $_.Exception.Message -like "*truy cap*") {
            Write-Host "       [TIP] Khong co quyen truy cap. Vui long chay script voi quyen Administrator." -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Hoan thanh!" -ForegroundColor Cyan
Write-Host "Thanh cong: $successCount" -ForegroundColor Green
Write-Host "That bai: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Gray" })
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "Luu y: Mot so file/thu muc co the dang duoc su dung." -ForegroundColor Yellow
    Write-Host "Vui long dong ung dung hoan toan va chay lai script." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Nhan phim bat ky de thoat..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
























































































