# Backup v3.7.2 - 93 Media Tool Mix Nhac
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$d = (Get-Date).ToString('yyyyMMdd_HHmmss')
$b = "backup_v3.7.2_$d"
New-Item -ItemType Directory -Path $b -Force | Out-Null
$dirs = @('src','backend','electron','shared','docs','scripts','public','server')
foreach ($x in $dirs) {
  if (Test-Path $x) {
    Copy-Item -Path $x -Destination (Join-Path $b $x) -Recurse -Force
  }
}
$files = @('package.json','package-lock.json','tsconfig.json','tsconfig.node.json','vite.config.ts','electron-builder.json5','.gitignore','index.html','README.md','vite-plugin-obfuscate.ts','vite-plugin-obfuscate.js','vite-plugin-obfuscate.d.ts')
foreach ($f in $files) {
  if (Test-Path $f) {
    Copy-Item -Path $f -Destination (Join-Path $b $f) -Force
  }
}
if (Test-Path 'electron.vite.config.ts') { Copy-Item 'electron.vite.config.ts' $b -Force }
if (Test-Path 'offscreen.html') { Copy-Item 'offscreen.html' $b -Force }
$n = (Get-ChildItem $b -Recurse -File | Measure-Object).Count
"BACKUP_OK: $b ($n files)" | Out-File (Join-Path $b "BACKUP_INFO.txt") -Encoding utf8
Write-Output "BACKUP_OK: $b ($n files)"
