# Quick backup for v3.7.0
$ErrorActionPreference = "SilentlyContinue"
$projectDir = Split-Path -Parent $PSScriptRoot
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$dest = Join-Path $projectDir "backup_v3.7.0_$ts"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$dirs = @("src","backend","electron","shared","server","docs","scripts","public","build")
foreach ($d in $dirs) {
    if (Test-Path (Join-Path $projectDir $d)) {
        Copy-Item -Path (Join-Path $projectDir $d) -Destination $dest -Recurse -Force
    }
}
$files = @("package.json","package-lock.json","tsconfig.json","tsconfig.node.json","vite.config.ts","electron-builder.json5",".gitignore","index.html")
foreach ($f in $files) {
    if (Test-Path (Join-Path $projectDir $f)) {
        Copy-Item -Path (Join-Path $projectDir $f) -Destination $dest -Force
    }
}
Write-Host "Backup created: $dest"
