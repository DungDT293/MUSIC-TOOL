# Backup script for 93 Media Tool Mix Nhac
$date = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$backupName = "backup_$date"

# Get project root (parent of scripts directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backupDir = Join-Path $projectRoot "backups"
$backupPath = Join-Path $backupDir $backupName

# Create backups directory if not exists
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    Write-Host "Created backups directory: $backupDir"
}

Write-Host "=========================================="
Write-Host "Creating backup: $backupName"
Write-Host "Project root: $projectRoot"
Write-Host "=========================================="

# Change to project root
Set-Location $projectRoot

# Create backup zip
$excludeItems = @(
    'node_modules',
    'dist',
    'dist-electron',
    'release',
    '.git',
    'backups',
    '*.log',
    '.vscode',
    '.idea'
)

$zipPath = "$backupPath.zip"

# Get all files and folders to backup
$itemsToBackup = Get-ChildItem -Path . -Exclude $excludeItems | Where-Object {
    $excluded = $false
    foreach ($exclude in $excludeItems) {
        if ($_.Name -like $exclude -or $_.FullName -like "*\$exclude\*") {
            $excluded = $true
            break
        }
    }
    -not $excluded
}

# Create temporary directory for backup
$tempBackup = Join-Path $env:TEMP "backup_temp_$date"
New-Item -ItemType Directory -Path $tempBackup -Force | Out-Null

# Copy files
foreach ($item in $itemsToBackup) {
    $destPath = Join-Path $tempBackup $item.Name
    Copy-Item -Path $item.FullName -Destination $destPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Compress
Compress-Archive -Path "$tempBackup\*" -DestinationPath $zipPath -Force

# Cleanup temp directory
Remove-Item -Path $tempBackup -Recurse -Force

# Get file size
$fileSize = (Get-Item $zipPath).Length / 1MB
$fileSizeFormatted = "{0:N2}" -f $fileSize

Write-Host ""
Write-Host "=========================================="
Write-Host "Backup completed successfully!"
Write-Host "Location: $zipPath"
Write-Host "Size: $fileSizeFormatted MB"
Write-Host "=========================================="

