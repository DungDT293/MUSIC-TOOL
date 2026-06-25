param(
    [switch]$Execute,
    [int]$OlderThanDays = 14,
    [string[]]$ExtraLogDirs = @(),
    [switch]$IncludeDevCaches,
    [string]$LogDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'logs')
)

$ErrorActionPreference = 'Stop'

$UserProfile = [Environment]::GetFolderPath('UserProfile')
$LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
$ProgramData = $env:ProgramData
$Now = Get-Date
$Cutoff = $Now.AddDays(-1 * [Math]::Max(1, $OlderThanDays))
$UserTempRoot = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) {
    $env:TEMP
}
else {
    Join-Path $LocalAppData 'Temp'
}

$NeverDeleteRoots = @(
    'C:\',
    'C:\Windows',
    'C:\Windows\System32',
    'C:\Windows\SysWOW64',
    'C:\Windows\WinSxS',
    'C:\Windows\Installer',
    'C:\Program Files',
    'C:\Program Files (x86)',
    'C:\inetpub',
    'C:\nginx',
    'C:\Apache24',
    'C:\xampp',
    'C:\www',
    'C:\sites',
    'C:\ProgramData\Docker',
    'C:\ProgramData\MySQL',
    'C:\ProgramData\PostgreSQL',
    'C:\ProgramData\MongoDB',
    'C:\ProgramData\Microsoft\SQL Server',
    'C:\ProgramData\Redis'
)

$SafeCleanupRoots = @(
    $UserTempRoot,
    (Join-Path $LocalAppData 'Temp'),
    'C:\Windows\Temp',
    (Join-Path $LocalAppData 'CrashDumps'),
    (Join-Path $ProgramData 'Microsoft\Windows\WER\ReportArchive'),
    (Join-Path $ProgramData 'Microsoft\Windows\WER\ReportQueue')
) | Where-Object { $_ }

$CleanupScanRoots = @(
    $UserTempRoot,
    'C:\Windows\Temp',
    (Join-Path $LocalAppData 'CrashDumps'),
    (Join-Path $ProgramData 'Microsoft\Windows\WER\ReportArchive'),
    (Join-Path $ProgramData 'Microsoft\Windows\WER\ReportQueue')
) | Where-Object { $_ }

if ($IncludeDevCaches) {
    $devCacheRoots = @(
        (Join-Path $LocalAppData 'pip\cache'),
        (Join-Path $LocalAppData 'npm-cache'),
        (Join-Path $LocalAppData 'Yarn\Cache'),
        (Join-Path $LocalAppData 'pnpm-store'),
        (Join-Path $UserProfile '.gradle\caches'),
        (Join-Path $UserProfile '.nuget\packages'),
        (Join-Path $UserProfile '.cargo\registry\cache')
    )
    $SafeCleanupRoots += $devCacheRoots
    $CleanupScanRoots += $devCacheRoots
}

$AllowedExtraLogExtensions = @(
    '.log', '.txt', '.tmp', '.bak', '.old', '.dmp', '.etl',
    '.zip', '.gz', '.7z', '.rar'
)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir ("vps-cleaner-{0:yyyyMMdd-HHmmss}.log" -f $Now)

function Write-Log {
    param([Parameter(Mandatory = $true)][string]$Message)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line
}

function Resolve-SafePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'Empty path is not allowed.'
    }

    try {
        if (Test-Path -LiteralPath $Path) {
            return (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
        }

        $parent = Split-Path -Parent $Path
        if ($parent -and (Test-Path -LiteralPath $parent)) {
            $resolvedParent = (Resolve-Path -LiteralPath $parent).Path.TrimEnd('\')
            return (Join-Path $resolvedParent (Split-Path -Leaf $Path)).TrimEnd('\')
        }
    }
    catch {
        throw "Cannot resolve path: $Path"
    }

    return $Path.TrimEnd('\')
}

function Get-UniqueResolvedPaths {
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    $seen = @{}
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }

        try {
            $resolved = Resolve-SafePath $path
        }
        catch {
            $resolved = $path.TrimEnd('\')
        }

        $key = $resolved.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            $resolved
        }
    }
}

function Test-IsUnderRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $target = Resolve-SafePath $Path
    $safeRoot = Resolve-SafePath $Root
    return $target.Equals($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $target.StartsWith($safeRoot + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NotDenied {
    param([Parameter(Mandatory = $true)][string]$Path)

    $target = Resolve-SafePath $Path
    foreach ($root in $NeverDeleteRoots) {
        $normalizedRoot = $root.TrimEnd('\')
        if ($target.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Blocked exact protected path: $target"
        }

        if ($root -notin @('C:\', 'C:\Windows', 'C:\Program Files', 'C:\Program Files (x86)') -and
            $target.StartsWith($normalizedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Blocked protected subtree: $target"
        }
    }

    if ($target.StartsWith('C:\Windows\', [StringComparison]::OrdinalIgnoreCase) -and
        -not $target.StartsWith('C:\Windows\Temp\', [StringComparison]::OrdinalIgnoreCase) -and
        -not $target.Equals('C:\Windows\Temp', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Blocked Windows subtree outside Temp: $target"
    }

    if (($target.StartsWith('C:\Program Files\', [StringComparison]::OrdinalIgnoreCase)) -or
        ($target.StartsWith('C:\Program Files (x86)\', [StringComparison]::OrdinalIgnoreCase))) {
        throw "Blocked Program Files subtree: $target"
    }
}

function Assert-UnderSafeRoot {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-NotDenied $Path

    foreach ($root in $SafeCleanupRoots) {
        if ($root -and (Test-IsUnderRoot -Path $Path -Root $root)) {
            return
        }
    }

    throw "Path is not under VPS safe cleanup roots: $Path"
}

function Format-Bytes {
    param([Int64]$Bytes)
    if ($Bytes -ge 1TB) { return ('{0:N2} TB' -f ($Bytes / 1TB)) }
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

function Get-FolderSizeBytes {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return 0 }

    $total = 0L
    Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object { $total += $_.Length }
    return $total
}

function Write-DriveSummary {
    param([Parameter(Mandatory = $true)][string]$Label)

    $drive = Get-PSDrive -Name C
    $total = $drive.Used + $drive.Free
    Write-Log ("{0}: C free {1} / total {2}" -f $Label, (Format-Bytes $drive.Free), (Format-Bytes $total))
}

function Remove-OldFilesInRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string[]]$Extensions = @()
    )

    if (-not (Test-Path -LiteralPath $Root)) { return 0L }
    Assert-UnderSafeRoot $Root

    $deletedBytes = 0L
    $mode = if ($Execute) { 'DELETE' } else { 'DRYRUN' }
    Write-Log "$mode root: $Root, older than $OlderThanDays days"

    Get-ChildItem -LiteralPath $Root -Force -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $_.LastWriteTime -lt $Cutoff -and
            (($Extensions.Count -eq 0) -or ($Extensions -contains $_.Extension.ToLowerInvariant()))
        } |
        ForEach-Object {
            $file = $_
            try {
                Assert-UnderSafeRoot $file.FullName
                Assert-NotDenied $file.FullName
                $deletedBytes += $file.Length

                if ($Execute) {
                    Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                    Write-Log ("Deleted {0}: {1}" -f (Format-Bytes $file.Length), $file.FullName)
                }
                else {
                    Write-Log ("Would delete {0}: {1}" -f (Format-Bytes $file.Length), $file.FullName)
                }
            }
            catch {
                Write-Log "Skipped: $($file.FullName) - $($_.Exception.Message)"
            }
        }

    return $deletedBytes
}

function Remove-EmptyDirs {
    param([Parameter(Mandatory = $true)][string]$Root)

    if (-not $Execute) { return }
    if (-not (Test-Path -LiteralPath $Root)) { return }
    Assert-UnderSafeRoot $Root

    Get-ChildItem -LiteralPath $Root -Force -Recurse -Directory -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        ForEach-Object {
            $dir = $_
            try {
                if (-not (Get-ChildItem -LiteralPath $dir.FullName -Force -ErrorAction SilentlyContinue)) {
                    Remove-Item -LiteralPath $dir.FullName -Force -ErrorAction Stop
                    Write-Log "Removed empty dir: $($dir.FullName)"
                }
            }
            catch {
                Write-Log "Skipped empty dir cleanup: $($dir.FullName) - $($_.Exception.Message)"
            }
        }
}

function Write-ServiceWarnings {
    $servicePatterns = 'mysql', 'mariadb', 'postgres', 'mongodb', 'mssql', 'redis', 'w3svc', 'nginx', 'apache', 'docker'
    $services = Get-Service -ErrorAction SilentlyContinue |
        Where-Object {
            $name = $_.Name.ToLowerInvariant()
            $display = $_.DisplayName.ToLowerInvariant()
            foreach ($pattern in $servicePatterns) {
                if ($name.Contains($pattern) -or $display.Contains($pattern)) { return $true }
            }
            return $false
        }

    if ($services) {
        Write-Log 'Detected server services. Script will not stop services or clean their data directories:'
        $services | Sort-Object Name | ForEach-Object {
            Write-Log ("Service {0} [{1}] status={2}" -f $_.Name, $_.DisplayName, $_.Status)
        }
    }
}

Write-Log 'VPS C Drive Cleaner started.'
Write-Log "Mode: $(if ($Execute) { 'EXECUTE' } else { 'DRY-RUN only, no files will be deleted' })"
Write-Log "OlderThanDays: $OlderThanDays"
Write-Log "LogFile: $LogFile"
Write-ServiceWarnings
Write-DriveSummary 'Before'

$totalCandidateBytes = 0L

foreach ($root in Get-UniqueResolvedPaths $CleanupScanRoots) {
    if (-not $root) { continue }
    try {
        $totalCandidateBytes += Remove-OldFilesInRoot -Root $root
        Remove-EmptyDirs -Root $root
    }
    catch {
        Write-Log "Skipped safe root: $root - $($_.Exception.Message)"
    }
}

foreach ($dir in $ExtraLogDirs) {
    if (-not (Test-Path -LiteralPath $dir)) {
        Write-Log "ExtraLogDir missing, skipped: $dir"
        continue
    }

    try {
        Assert-NotDenied $dir
        Write-Log "ExtraLogDir is file-only cleanup with extension filter: $dir"
        Get-ChildItem -LiteralPath $dir -Force -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.LastWriteTime -lt $Cutoff -and
                $AllowedExtraLogExtensions -contains $_.Extension.ToLowerInvariant()
            } |
            ForEach-Object {
                $file = $_
                try {
                    Assert-NotDenied $file.FullName
                    $totalCandidateBytes += $file.Length
                    if ($Execute) {
                        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                        Write-Log ("Deleted extra log {0}: {1}" -f (Format-Bytes $file.Length), $file.FullName)
                    }
                    else {
                        Write-Log ("Would delete extra log {0}: {1}" -f (Format-Bytes $file.Length), $file.FullName)
                    }
                }
                catch {
                    Write-Log "Skipped extra log: $($file.FullName) - $($_.Exception.Message)"
                }
            }
    }
    catch {
        Write-Log "Blocked ExtraLogDir: $dir - $($_.Exception.Message)"
    }
}

Write-Log ("Candidate cleaned size: {0}" -f (Format-Bytes $totalCandidateBytes))
Write-DriveSummary 'After'
Write-Log 'VPS C Drive Cleaner finished.'

if (-not $Execute) {
    Write-Log 'Dry-run complete. Re-run with -Execute only after reviewing this log.'
}
