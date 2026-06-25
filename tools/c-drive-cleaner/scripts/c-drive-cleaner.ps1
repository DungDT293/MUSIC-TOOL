param(
    [switch]$ScanOnly,
    [switch]$CleanPip,
    [switch]$CleanNpm,
    [switch]$CleanChrome,
    [switch]$CleanBrowsers,
    [switch]$CleanDevCaches,
    [switch]$CleanAppCaches,
    [switch]$CleanCapCut,
    [switch]$CleanTemp,
    [switch]$CleanAllSafe,
    [switch]$AggressiveSafe,
    [switch]$StopCapCut,
    [switch]$StopChrome,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$UserProfile = [Environment]::GetFolderPath('UserProfile')
$LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
$RoamingAppData = [Environment]::GetFolderPath('ApplicationData')
$ProgramData = $env:ProgramData

$AllowedDeleteRoots = @(
    (Join-Path $LocalAppData 'pip'),
    (Join-Path $LocalAppData 'npm-cache'),
    (Join-Path $LocalAppData 'Temp'),
    'C:\Windows\Temp',
    (Join-Path $LocalAppData 'Google\Chrome\User Data'),
    (Join-Path $LocalAppData 'Google\Chrome for Testing\User Data'),
    (Join-Path $LocalAppData 'Microsoft\Edge\User Data'),
    (Join-Path $LocalAppData 'BraveSoftware\Brave-Browser\User Data'),
    (Join-Path $LocalAppData 'Mozilla\Firefox\Profiles'),
    (Join-Path $LocalAppData 'CapCut'),
    (Join-Path $LocalAppData 'Yarn'),
    (Join-Path $LocalAppData 'pnpm-store'),
    (Join-Path $LocalAppData 'pnpm'),
    (Join-Path $LocalAppData 'ms-playwright'),
    (Join-Path $LocalAppData 'Playwright'),
    (Join-Path $UserProfile '.gradle\caches'),
    (Join-Path $UserProfile '.nuget\packages'),
    (Join-Path $UserProfile '.cargo\registry\cache'),
    (Join-Path $UserProfile '.cargo\git\db'),
    (Join-Path $UserProfile '.cache\pip'),
    (Join-Path $UserProfile '.cache\yarn'),
    (Join-Path $LocalAppData 'CrashDumps'),
    (Join-Path $LocalAppData 'D3DSCache'),
    (Join-Path $LocalAppData 'NVIDIA\DXCache'),
    (Join-Path $LocalAppData 'NVIDIA\GLCache'),
    (Join-Path $RoamingAppData 'Code'),
    (Join-Path $RoamingAppData 'Cursor')
)

function Resolve-SafePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        if (Test-Path -LiteralPath $Path) {
            return (Resolve-Path -LiteralPath $Path).Path
        }

        $parent = Split-Path -Parent $Path
        if ($parent -and (Test-Path -LiteralPath $parent)) {
            $resolvedParent = (Resolve-Path -LiteralPath $parent).Path
            return (Join-Path $resolvedParent (Split-Path -Leaf $Path))
        }
    }
    catch {
        throw "Khong resolve duoc path: $Path"
    }

    return $Path
}

function Assert-UnderAllowedRoot {
    param([Parameter(Mandatory = $true)][string]$Path)

    $target = (Resolve-SafePath $Path).TrimEnd('\')
    foreach ($root in $AllowedDeleteRoots) {
        $safeRoot = (Resolve-SafePath $root).TrimEnd('\')
        if ($target.Equals($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or
            $target.StartsWith($safeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            return
        }
    }

    throw "Chan xoa path ngoai whitelist: $target"
}

function Format-Bytes {
    param([Nullable[Int64]]$Bytes)

    if ($null -eq $Bytes) { return 'n/a' }
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
    try {
        Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue |
            Where-Object { -not $_.PSIsContainer } |
            ForEach-Object { $total += $_.Length }
    }
    catch {
        Write-Warning "Khong doc het duoc: $Path"
    }

    return $total
}

function Get-DriveSummary {
    $drive = Get-PSDrive -Name C
    [PSCustomObject]@{
        Used = $drive.Used
        Free = $drive.Free
        Total = $drive.Used + $drive.Free
    }
}

function Write-DriveSummary {
    param([string]$Label)

    $summary = Get-DriveSummary
    Write-Host ""
    Write-Host "== $Label =="
    Write-Host ("C: Used {0} / Total {1}; Free {2}" -f (Format-Bytes $summary.Used), (Format-Bytes $summary.Total), (Format-Bytes $summary.Free))
}

function Confirm-Action {
    param([Parameter(Mandatory = $true)][string]$Message)

    if ($Force) { return $true }
    $answer = Read-Host "$Message (y/N)"
    return $answer -match '^(y|yes)$'
}

function Remove-TargetDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    Assert-UnderAllowedRoot $Path

    $before = Get-FolderSizeBytes $Path
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        Write-Host ("Deleted {0}: {1}" -f (Format-Bytes $before), $Path)
    }
    catch {
        Write-Warning "Skip locked/failed: $Path - $($_.Exception.Message)"
    }

    return $before
}

function Remove-DirectoryContents {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    Assert-UnderAllowedRoot $Path

    $before = Get-FolderSizeBytes $Path
    Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $item = $_
        try {
            Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Skip locked/failed: $($item.FullName) - $($_.Exception.Message)"
        }
    }

    Write-Host ("Cleaned about {0}: {1}" -f (Format-Bytes $before), $Path)
    return $before
}

function Invoke-IfCommandExists {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $cmd = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Warning "Khong tim thay command: $Command"
        return
    }

    try {
        & $cmd.Source @Arguments
    }
    catch {
        Write-Warning "$Command failed: $($_.Exception.Message)"
    }
}

function Show-Scan {
    Write-DriveSummary 'Drive summary'

    $knownTargets = @(
        (Join-Path $LocalAppData 'pip'),
        (Join-Path $LocalAppData 'npm-cache'),
        (Join-Path $LocalAppData 'Google'),
        (Join-Path $LocalAppData 'Microsoft\Edge'),
        (Join-Path $LocalAppData 'BraveSoftware'),
        (Join-Path $LocalAppData 'Mozilla\Firefox\Profiles'),
        (Join-Path $LocalAppData 'CapCut'),
        (Join-Path $LocalAppData 'Temp'),
        'C:\Windows\Temp',
        (Join-Path $LocalAppData 'Yarn'),
        (Join-Path $LocalAppData 'pnpm-store'),
        (Join-Path $LocalAppData 'pnpm'),
        (Join-Path $UserProfile '.gradle\caches'),
        (Join-Path $UserProfile '.nuget\packages'),
        (Join-Path $UserProfile '.cargo\registry\cache'),
        (Join-Path $LocalAppData 'ms-playwright'),
        (Join-Path $LocalAppData 'CrashDumps'),
        (Join-Path $LocalAppData 'D3DSCache'),
        (Join-Path $LocalAppData 'NVIDIA\DXCache'),
        (Join-Path $LocalAppData 'NVIDIA\GLCache'),
        (Join-Path $RoamingAppData 'Code'),
        (Join-Path $RoamingAppData 'Cursor')
    )

    Write-Host ""
    Write-Host "== Known cache folders =="
    $knownTargets | ForEach-Object {
        $size = Get-FolderSizeBytes $_
        [PSCustomObject]@{ Size = $size; HumanSize = Format-Bytes $size; Path = $_ }
    } | Sort-Object Size -Descending | Format-Table HumanSize, Path -AutoSize

    Write-Host ""
    Write-Host "== Top folders under C:\Users and C:\ProgramData =="
    @($UserProfile, $ProgramData) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $size = Get-FolderSizeBytes $_.FullName
            [PSCustomObject]@{ Size = $size; HumanSize = Format-Bytes $size; Path = $_.FullName }
        }
    } | Sort-Object Size -Descending | Select-Object -First 20 HumanSize, Path | Format-Table -AutoSize

    Write-Host ""
    Write-Host "== Large executable/script candidates in user writable locations =="
    $scanRoots = @(
        (Join-Path $UserProfile 'Downloads'),
        (Join-Path $UserProfile 'Desktop'),
        $LocalAppData,
        $RoamingAppData,
        $ProgramData
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $exts = '.exe', '.msi', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jar', '.dll'
    $largeFiles = foreach ($root in $scanRoots) {
        Get-ChildItem -LiteralPath $root -Force -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Length -ge 100MB -and $exts -contains $_.Extension.ToLowerInvariant() }
    }

    $largeFiles | Sort-Object Length -Descending | Select-Object -First 30 | ForEach-Object {
        $sigStatus = 'n/a'
        if ($_.Extension.ToLowerInvariant() -in '.exe', '.dll', '.msi') {
            try { $sigStatus = (Get-AuthenticodeSignature -LiteralPath $_.FullName).Status } catch { $sigStatus = 'unknown' }
        }
        [PSCustomObject]@{
            Size = Format-Bytes $_.Length
            Signature = $sigStatus
            Path = $_.FullName
        }
    } | Format-Table -AutoSize
}

function Stop-ProcessesByName {
    param([Parameter(Mandatory = $true)][string[]]$Names)

    foreach ($name in $Names) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
            $process = $_
            try {
                Write-Host "Stopping process: $($process.ProcessName) ($($process.Id))"
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
            }
            catch {
                Write-Warning "Khong stop duoc $($process.ProcessName): $($_.Exception.Message)"
            }
        }
    }
}

function Test-AnyProcessRunning {
    param([Parameter(Mandatory = $true)][string[]]$Names)

    foreach ($name in $Names) {
        if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
            return $true
        }
    }

    return $false
}

function Get-ChromiumProfileRoots {
    param([Parameter(Mandatory = $true)][string[]]$UserDataRoots)

    foreach ($root in $UserDataRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Get-ChildItem -LiteralPath $root -Force -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' -or $_.Name -eq 'Guest Profile' } |
            Select-Object -ExpandProperty FullName
    }
}

function Clean-ChromiumBrowser {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$UserDataRoots,
        [Parameter(Mandatory = $true)][string[]]$ProcessNames,
        [switch]$AllowStop
    )

    $browserRunning = Test-AnyProcessRunning $ProcessNames
    if ($browserRunning -and $AllowStop) {
        Stop-ProcessesByName $ProcessNames
        Start-Sleep -Seconds 2
        $browserRunning = Test-AnyProcessRunning $ProcessNames
    }

    foreach ($root in $UserDataRoots) {
        Remove-TargetDirectory (Join-Path $root 'OptGuideOnDeviceModel') | Out-Null
        Remove-TargetDirectory (Join-Path $root 'BrowserMetrics') | Out-Null
    }

    if ($browserRunning) {
        Write-Warning "$Name dang mo, bo qua profile cache bi khoa."
        return
    }

    $cacheSubdirs = @(
        'Cache',
        'Code Cache',
        'GPUCache',
        'DawnCache',
        'GrShaderCache',
        'ShaderCache',
        'Media Cache',
        'Service Worker\CacheStorage',
        'Service Worker\ScriptCache'
    )

    foreach ($profile in Get-ChromiumProfileRoots $UserDataRoots) {
        foreach ($subdir in $cacheSubdirs) {
            Remove-TargetDirectory (Join-Path $profile $subdir) | Out-Null
        }
    }
}

function Clean-Firefox {
    if (Test-AnyProcessRunning @('firefox', 'waterfox', 'librewolf')) {
        Write-Warning 'Firefox dang mo, bo qua cache bi khoa.'
        return
    }

    $profilesRoot = Join-Path $LocalAppData 'Mozilla\Firefox\Profiles'
    if (-not (Test-Path -LiteralPath $profilesRoot)) { return }

    $cacheSubdirs = @(
        'cache2',
        'startupCache',
        'thumbnails',
        'shader-cache'
    )

    Get-ChildItem -LiteralPath $profilesRoot -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $profile = $_.FullName
        foreach ($subdir in $cacheSubdirs) {
            Remove-TargetDirectory (Join-Path $profile $subdir) | Out-Null
        }
    }
}

function Clean-Pip {
    if (-not (Confirm-Action 'Don pip cache?')) { return }

    Invoke-IfCommandExists 'python.exe' @('-m', 'pip', 'cache', 'purge')
    Remove-DirectoryContents (Join-Path $LocalAppData 'pip\cache') | Out-Null
}

function Clean-Npm {
    if (-not (Confirm-Action 'Don npm cache?')) { return }

    Invoke-IfCommandExists 'npm.cmd' @('cache', 'clean', '--force')
    $npmCache = Join-Path $LocalAppData 'npm-cache'
    @('_npx', '_prebuilds', '_libvips') | ForEach-Object {
        Remove-TargetDirectory (Join-Path $npmCache $_) | Out-Null
    }
}

function Clean-Chrome {
    if (-not (Confirm-Action 'Don Chrome cache?')) { return }

    Clean-ChromiumBrowser `
        -Name 'Chrome' `
        -UserDataRoots @(
        (Join-Path $LocalAppData 'Google\Chrome\User Data'),
        (Join-Path $LocalAppData 'Google\Chrome for Testing\User Data')
        ) `
        -ProcessNames @('chrome') `
        -AllowStop:$StopChrome
}

function Clean-Browsers {
    if (-not (Confirm-Action 'Don browser cache Chrome/Edge/Brave/Firefox?')) { return }

    Clean-ChromiumBrowser `
        -Name 'Chrome' `
        -UserDataRoots @(
            (Join-Path $LocalAppData 'Google\Chrome\User Data'),
            (Join-Path $LocalAppData 'Google\Chrome for Testing\User Data')
        ) `
        -ProcessNames @('chrome') `
        -AllowStop:$StopChrome

    Clean-ChromiumBrowser `
        -Name 'Edge' `
        -UserDataRoots @((Join-Path $LocalAppData 'Microsoft\Edge\User Data')) `
        -ProcessNames @('msedge')

    Clean-ChromiumBrowser `
        -Name 'Brave' `
        -UserDataRoots @((Join-Path $LocalAppData 'BraveSoftware\Brave-Browser\User Data')) `
        -ProcessNames @('brave')

    Clean-Firefox
}

function Clean-DevCaches {
    if (-not (Confirm-Action 'Don dev caches Yarn/pnpm/Gradle/NuGet/Cargo/Playwright?')) { return }

    Invoke-IfCommandExists 'yarn.cmd' @('cache', 'clean')
    Invoke-IfCommandExists 'pnpm.cmd' @('store', 'prune')

    $targets = @(
        (Join-Path $LocalAppData 'Yarn\Cache'),
        (Join-Path $LocalAppData 'Yarn\Berry\cache'),
        (Join-Path $LocalAppData 'pnpm-store'),
        (Join-Path $LocalAppData 'pnpm\store'),
        (Join-Path $UserProfile '.gradle\caches'),
        (Join-Path $UserProfile '.nuget\packages'),
        (Join-Path $UserProfile '.cargo\registry\cache'),
        (Join-Path $UserProfile '.cargo\git\db'),
        (Join-Path $UserProfile '.cache\pip'),
        (Join-Path $UserProfile '.cache\yarn'),
        (Join-Path $LocalAppData 'ms-playwright'),
        (Join-Path $LocalAppData 'Playwright')
    )

    foreach ($target in $targets) {
        Remove-TargetDirectory $target | Out-Null
    }
}

function Clean-CodeLikeAppCache {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string[]]$ProcessNames
    )

    if (Test-AnyProcessRunning $ProcessNames) {
        Write-Warning "$Name dang mo, bo qua cache bi khoa."
        return
    }

    $cacheSubdirs = @(
        'Cache',
        'CachedData',
        'Code Cache',
        'GPUCache',
        'DawnCache',
        'Service Worker\CacheStorage',
        'Service Worker\ScriptCache'
    )

    foreach ($subdir in $cacheSubdirs) {
        Remove-TargetDirectory (Join-Path $Root $subdir) | Out-Null
    }
}

function Clean-AppCaches {
    if (-not (Confirm-Action 'Don app/system caches an toan?')) { return }

    Remove-DirectoryContents (Join-Path $LocalAppData 'CrashDumps') | Out-Null
    Remove-DirectoryContents (Join-Path $LocalAppData 'D3DSCache') | Out-Null
    Remove-DirectoryContents (Join-Path $LocalAppData 'NVIDIA\DXCache') | Out-Null
    Remove-DirectoryContents (Join-Path $LocalAppData 'NVIDIA\GLCache') | Out-Null

    Clean-CodeLikeAppCache `
        -Name 'VS Code' `
        -Root (Join-Path $RoamingAppData 'Code') `
        -ProcessNames @('Code')

    Clean-CodeLikeAppCache `
        -Name 'Cursor' `
        -Root (Join-Path $RoamingAppData 'Cursor') `
        -ProcessNames @('Cursor')
}

function Clean-CapCut {
    if (-not (Confirm-Action 'Don CapCut cache?')) { return }

    $capCutProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match 'CapCut|CapCutDraft|parfait_crash_handler'
    }

    if ($capCutProcesses -and $StopCapCut) {
        $capCutProcesses | ForEach-Object {
            $process = $_
            try {
                Write-Host "Stopping process: $($process.ProcessName) ($($process.Id))"
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
            }
            catch {
                Write-Warning "Khong stop duoc $($process.ProcessName): $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 2
        $capCutProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ProcessName -match 'CapCut|CapCutDraft|parfait_crash_handler'
        }
    }

    if ($capCutProcesses) {
        Write-Warning 'CapCut dang mo, bo qua cache de tranh lock file. Chay lai voi -StopCapCut neu muon tool tu tat CapCut.'
        return
    }

    $capCutRoot = Join-Path $LocalAppData 'CapCut'
    $cacheDirs = @(
        'User Data\Cache\SmartCrop',
        'User Data\Cache\agencycache',
        'User Data\Cache\ressdk_db',
        'User Data\Cache\audioWave',
        'User Data\Cache\effect',
        'User Data\Cache\VENetworkPlayer',
        'User Data\Cache\fontImage',
        'User Data\Cache\GeckoCpp',
        'User Data\Cache\image',
        'User Data\Cache\matting',
        'User Data\Cache\cloudDraft',
        'User Data\Cache\RemuxCache',
        'User Data\Cache\tmp',
        'User Data\Cache\prerender',
        'User Data\Cache\segmentPrerenderCache'
    )

    foreach ($dir in $cacheDirs) {
        Remove-TargetDirectory (Join-Path $capCutRoot $dir) | Out-Null
    }
}

function Clean-Temp {
    if (-not (Confirm-Action 'Don temp folders?')) { return }

    Remove-DirectoryContents (Join-Path $LocalAppData 'Temp') | Out-Null
    Remove-DirectoryContents 'C:\Windows\Temp' | Out-Null
}

if (-not ($ScanOnly -or $CleanPip -or $CleanNpm -or $CleanChrome -or $CleanBrowsers -or $CleanDevCaches -or $CleanAppCaches -or $CleanCapCut -or $CleanTemp -or $CleanAllSafe -or $AggressiveSafe)) {
    $ScanOnly = $true
}

if ($ScanOnly) {
    Show-Scan
    exit 0
}

Write-DriveSummary 'Before cleanup'

if ($CleanAllSafe) {
    $CleanPip = $true
    $CleanNpm = $true
    $CleanTemp = $true
    $CleanChrome = $true
    $CleanCapCut = $true
}

if ($AggressiveSafe) {
    $CleanPip = $true
    $CleanNpm = $true
    $CleanTemp = $true
    $CleanBrowsers = $true
    $CleanCapCut = $true
    $CleanDevCaches = $true
    $CleanAppCaches = $true
}

if ($CleanPip) { Clean-Pip }
if ($CleanNpm) { Clean-Npm }
if ($CleanTemp) { Clean-Temp }
if ($CleanBrowsers) { Clean-Browsers } elseif ($CleanChrome) { Clean-Chrome }
if ($CleanCapCut) { Clean-CapCut }
if ($CleanDevCaches) { Clean-DevCaches }
if ($CleanAppCaches) { Clean-AppCaches }

Write-DriveSummary 'After cleanup'
