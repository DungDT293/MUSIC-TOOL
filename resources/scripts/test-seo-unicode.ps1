# Test SEO Metadata với Unicode (Tiếng Việt, Trung, Nhật, Indo...)
# Usage: .\scripts\test-seo-unicode.ps1 -VideoPath "path\to\video.mp4"

param(
    [Parameter(Mandatory=$true)]
    [string]$VideoPath
)

if (-not (Test-Path $VideoPath)) {
    Write-Host "ERROR: Video file not found: $VideoPath" -ForegroundColor Red
    exit 1
}

Write-Host "=== Testing SEO Metadata with Unicode ===" -ForegroundColor Cyan
Write-Host "Video: $VideoPath" -ForegroundColor Yellow
Write-Host ""

# Test data với nhiều ngôn ngữ
$testCases = @(
    @{
        Name = "Vietnamese"
        Title = "Video Tiếng Việt - Hướng dẫn SEO"
        Channel = "Kênh Việt Nam"
        Genre = "Giải trí"
    },
    @{
        Name = "Chinese"
        Title = "中文视频 - SEO教程"
        Channel = "中国频道"
        Genre = "娱乐"
    },
    @{
        Name = "Japanese"
        Title = "日本語動画 - SEOガイド"
        Channel = "日本のチャンネル"
        Genre = "エンターテインメント"
    },
    @{
        Name = "Indonesian"
        Title = "Video Bahasa Indonesia - Panduan SEO"
        Channel = "Saluran Indonesia"
        Genre = "Hiburan"
    },
    @{
        Name = "Mixed"
        Title = "Mixed: Tiếng Việt + 中文 + 日本語 + Bahasa"
        Channel = "Multi-language Channel"
        Genre = "Multi-genre"
    }
)

$testFile = $VideoPath
$backupFile = "$VideoPath.backup"

# Backup original
Write-Host "Creating backup..." -ForegroundColor Yellow
Copy-Item $testFile $backupFile -Force

try {
    foreach ($testCase in $testCases) {
        Write-Host ""
        Write-Host "Testing: $($testCase.Name)" -ForegroundColor Green
        Write-Host "  Title: $($testCase.Title)"
        Write-Host "  Channel: $($testCase.Channel)"
        Write-Host "  Genre: $($testCase.Genre)"
        
        # Restore from backup
        Copy-Item $backupFile $testFile -Force
        
        # Test với AtomicParsley
        Write-Host "  Applying AtomicParsley..." -ForegroundColor Cyan
        & "bin\AtomicParsley.exe" $testFile `
            --overWrite `
            --title $testCase.Title `
            --artist $testCase.Channel `
            --albumArtist $testCase.Channel `
            --comment $testCase.Title `
            --description $testCase.Title `
            --genre $testCase.Genre `
            --year "2025" `
            --keyword $testCase.Title
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ AtomicParsley success" -ForegroundColor Green
        } else {
            Write-Host "  ✗ AtomicParsley failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
        }
        
        # Verify với exiftool
        Write-Host "  Verifying with exiftool..." -ForegroundColor Cyan
        $title = & "bin\exiftool.exe" -s -s -s -Title $testFile
        $artist = & "bin\exiftool.exe" -s -s -s -Artist $testFile
        $genre = & "bin\exiftool.exe" -s -s -s -Genre $testFile
        
        Write-Host "  Read Title: $title" -ForegroundColor $(if ($title -eq $testCase.Title) { "Green" } else { "Red" })
        Write-Host "  Read Artist: $artist" -ForegroundColor $(if ($artist -eq $testCase.Channel) { "Green" } else { "Red" })
        Write-Host "  Read Genre: $genre" -ForegroundColor $(if ($genre -eq $testCase.Genre) { "Green" } else { "Red" })
        
        # Check Windows Properties
        Write-Host "  Checking Windows Properties..." -ForegroundColor Cyan
        $shell = New-Object -ComObject Shell.Application
        $folder = $shell.Namespace((Split-Path $testFile))
        $file = $folder.ParseName((Split-Path $testFile -Leaf))
        $winTitle = $folder.GetDetailsOf($file, 21)  # Title
        $winArtist = $folder.GetDetailsOf($file, 20)  # Directors/Artists
        
        Write-Host "  Windows Title: $winTitle" -ForegroundColor $(if ($winTitle -eq $testCase.Title) { "Green" } else { "Yellow" })
        Write-Host "  Windows Artist: $winArtist" -ForegroundColor $(if ($winArtist -eq $testCase.Channel) { "Green" } else { "Yellow" })
        
        Write-Host ""
        Write-Host "  → Please check Windows Properties manually:" -ForegroundColor Yellow
        Write-Host "    Right-click file → Properties → Details tab" -ForegroundColor Yellow
        Write-Host "    Press any key to continue to next test..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
} finally {
    # Restore original
    Write-Host ""
    Write-Host "Restoring original file..." -ForegroundColor Yellow
    Copy-Item $backupFile $testFile -Force
    Remove-Item $backupFile -ErrorAction SilentlyContinue
    Write-Host "Done!" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host "All metadata should display correctly in Windows Explorer Properties" -ForegroundColor Green
