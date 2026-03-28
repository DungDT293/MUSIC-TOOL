# Backup Script
$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $projectDir "backups"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Doc version tu package.json
$packageJsonPath = Join-Path $projectDir "package.json"
$version = "unknown"
if (Test-Path $packageJsonPath) {
    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    $version = $packageJson.version
}

# Su dung ten file tu batch file neu co, neu khong thi tu tao
if ($env:BACKUP_NAME) {
    $backupName = $env:BACKUP_NAME
    $backupPath = $env:BACKUP_PATH + ".zip"
} else {
    $backupName = "backup_v$version_$timestamp"
    $backupPath = Join-Path $backupDir "$backupName.zip"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   BACKUP CODE - 93 Media Tool Mix Nhac" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Tao thu muc backup..." -ForegroundColor Yellow
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}
Write-Host "OK Thu muc backup: $backupDir" -ForegroundColor Green
Write-Host ""

# Danh sách thư mục cần loại trừ (không backup)
$excludeDirs = @(
    'node_modules',           # Dependencies (có thể cài lại bằng npm install)
    'dist',                    # Build output
    'dist-electron',           # Build output
    'dist-electron-output',    # Build output
    'release',                 # Release builds
    'out',                     # Build output
    'backups',                 # Thư mục backup (tránh backup trong backup)
    '.git',                    # Git repository
    '.vscode',                 # VS Code settings
    '.idea',                   # IntelliJ IDEA settings
    'logs',                    # Log files
    'tmp',                     # Temporary files
    'temp',                    # Temporary files
    'dev-data'                 # Development data (license files, etc.)
)

# Danh sách file pattern cần loại trừ
$excludeFiles = @('*.log', '*.tmp', '*.cache', '*.tsbuildinfo', '*.backup')

# Danh sách thư mục/file QUAN TRỌNG cần đảm bảo backup (để kiểm tra)
$criticalItems = @(
    'src',                     # Source code frontend
    'backend',                 # Backend code
    'electron',                # Electron main/preload
    'shared',                  # Shared code
    'server',                  # Server code (nếu có)
    'scripts',                 # Scripts
    'docs',                    # Documentation
    'bin',                     # Binary files (ffmpeg, yt-dlp, etc.)
    'public',                  # Public assets
    'build',                   # Build configs
    'package.json',            # Project config
    'package-lock.json',       # Dependencies lock
    'tsconfig.json',           # TypeScript config
    'tsconfig.node.json',      # TypeScript node config
    'electron-builder.json5',  # Electron builder config
    'electron.vite.config.ts', # Electron Vite config
    'vite.config.ts',          # Vite config
    'index.html',              # Entry HTML
    '.gitignore'               # Git ignore
)

Write-Host "[2/4] Dang quet files..." -ForegroundColor Yellow
try {
    $allFiles = Get-ChildItem -Path $projectDir -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable +fileErrors
    if ($fileErrors.Count -gt 0) {
        Write-Host "  [WARN] Co $($fileErrors.Count) loi khi quet files (co the do quyen truy cap)" -ForegroundColor Yellow
    }
    
    $filesToBackup = $allFiles | Where-Object {
    $file = $_
        try {
    $relativePath = $file.FullName.Substring($projectDir.Length + 1)
            $pathParts = $relativePath.Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)
    $shouldExclude = $false
            
            # Kiem tra exclude dirs
    foreach ($part in $pathParts) {
        if ($excludeDirs -contains $part) {
            $shouldExclude = $true
            break
        }
    }
            
            # Kiem tra exclude file patterns
    if (-not $shouldExclude) {
        foreach ($pattern in $excludeFiles) {
            if ($file.Name -like $pattern) {
                $shouldExclude = $true
                break
            }
        }
    }
            
    -not $shouldExclude
        } catch {
            # Neu co loi khi xu ly file, bo qua file do
            Write-Host "  [WARN] Loi khi xu ly file: $($file.FullName) - $($_.Exception.Message)" -ForegroundColor Yellow
            $false
        }
}

    Write-Host "OK Tim thay $($filesToBackup.Count) files (tong $($allFiles.Count) files)" -ForegroundColor Green
} catch {
    Write-Host "ERROR Loi khi quet files: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Kiem tra cac item quan trong
Write-Host "[2.5/4] Kiem tra cac item quan trong..." -ForegroundColor Yellow
$missingItems = @()
foreach ($item in $criticalItems) {
    $itemPath = Join-Path $projectDir $item
    if (-not (Test-Path $itemPath)) {
        $missingItems += $item
        Write-Host "  [WARN] Thieu: $item" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] Co: $item" -ForegroundColor Green
    }
}
if ($missingItems.Count -gt 0) {
    Write-Host "  [WARN] Canh bao: Co $($missingItems.Count) item quan trong khong tim thay (co the la binh thuong neu khong co)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "[3/4] Dang nen code..." -ForegroundColor Yellow
if (Test-Path $backupPath) {
    Remove-Item $backupPath -Force
}

# Tao temp folder de chua files
$tempFolder = Join-Path $env:TEMP "backup_temp_$timestamp"
if (Test-Path $tempFolder) {
    Remove-Item $tempFolder -Recurse -Force
}
New-Item -ItemType Directory -Path $tempFolder -Force | Out-Null

# Copy files vao temp folder
foreach ($file in $filesToBackup) {
    $relativePath = $file.FullName.Substring($projectDir.Length + 1)
    $destPath = Join-Path $tempFolder $relativePath
    $destDir = Split-Path -Parent $destPath
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path $file.FullName -Destination $destPath -Force
}

# Nen thanh zip
Compress-Archive -Path "$tempFolder\*" -DestinationPath $backupPath -Force

# Xoa temp folder
Remove-Item $tempFolder -Recurse -Force

# Tao file BACKUP_INFO.json
$backupInfoPath = Join-Path $backupDir "$backupName.info.json"
$backupInfo = @{
    version = $version
    timestamp = $timestamp
    backupName = $backupName
    fileCount = $filesToBackup.Count
    fileSizeMB = [math]::Round((Get-Item $backupPath).Length / 1MB, 2)
    excludedDirs = $excludeDirs
    excludedFiles = $excludeFiles
    criticalItems = $criticalItems
    missingItems = $missingItems
    projectDir = $projectDir
} | ConvertTo-Json -Depth 3
$backupInfo | Out-File -FilePath $backupInfoPath -Encoding UTF8

Write-Host "OK Backup hoan tat!" -ForegroundColor Green
Write-Host "OK File: $backupName.zip" -ForegroundColor Green
$size = (Get-Item $backupPath).Length / 1MB
Write-Host "OK Kich thuoc: $([math]::Round($size, 2)) MB" -ForegroundColor Green
Write-Host "OK Thong tin backup: $backupName.info.json" -ForegroundColor Green
Write-Host ""

Write-Host "[4/4] Kiem tra backup..." -ForegroundColor Yellow
if (Test-Path $backupPath) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "   OK BACKUP THANH CONG!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "OK File: $backupName.zip" -ForegroundColor Green
    Write-Host "OK Thu muc: $backupDir" -ForegroundColor Green
    Write-Host ""
    $response = Read-Host "Mo thu muc backup? (Y/N)"
    if ($response -eq "Y" -or $response -eq "y") {
        explorer $backupDir
    }
} else {
    Write-Host ""
    Write-Host "ERROR Backup that bai! File khong ton tai." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Hoan tat!" -ForegroundColor Green
