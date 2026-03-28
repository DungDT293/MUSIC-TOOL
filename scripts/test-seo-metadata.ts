/**
 * Script test để kiểm tra các phương pháp ghi metadata
 * Chạy: npx ts-node scripts/test-seo-metadata.ts <path-to-video-file>
 */

import { spawn } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
// Copy functions từ backend
function getExiftoolPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'bin', 'exiftool.exe'),
    path.join(process.cwd(), 'bin', 'exiftool'),
    path.join((process as any).resourcesPath || '', 'bin', 'exiftool.exe'),
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function getFfmpegPaths(): { ffmpeg: string; ffprobe: string } {
  const isWindows = process.platform === 'win32'
  const exeExt = isWindows ? '.exe' : ''
  
  // Tìm trong bin folder
  const projectRoot = process.cwd()
  const binDir = path.join(projectRoot, 'bin')
  
  return {
    ffmpeg: path.join(binDir, `ffmpeg${exeExt}`),
    ffprobe: path.join(binDir, `ffprobe${exeExt}`),
  }
}

const testFile = process.argv[2]

if (!testFile || !fs.existsSync(testFile)) {
  console.error('Usage: npx ts-node scripts/test-seo-metadata.ts <path-to-video-file>')
  process.exit(1)
}

const testTitle = 'Test Title 2025'
const testTags = 'Tomorrowland, Tiësto, Techno'
const testRating = '100' // 5 sao

console.log('='.repeat(60))
console.log('TEST SEO METADATA - Kiểm tra từng phương pháp')
console.log('='.repeat(60))
console.log(`File: ${testFile}`)
console.log(`Title: ${testTitle}`)
console.log(`Tags: ${testTags}`)
console.log(`Rating: ${testRating} (5 sao)`)
console.log('')

// Helper để chạy command và đọc output
function runCommand(cmd: string, args: string[]): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (buf) => (stdout += buf.toString()))
    proc.stderr?.on('data', (buf) => (stderr += buf.toString()))
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr,
      })
    })
    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      })
    })
  })
}

// Helper để đọc metadata bằng exiftool
async function readMetadata(file: string): Promise<Record<string, string>> {
  const exiftoolPath = getExiftoolPath()
  if (!exiftoolPath) {
    return {}
  }

  const result = await runCommand(exiftoolPath, ['-G', '-s', '-s', '-s', file])
  const metadata: Record<string, string> = {}

  if (result.success) {
    result.output.split('\n').forEach((line) => {
      const match = line.match(/^\[([^\]]+)\]\s+(.+?)\s*=\s*(.+)$/)
      if (match) {
        const key = match[2].trim()
        const value = match[3].trim()
        metadata[key] = value
      }
    })
  }

  return metadata
}

async function testExiftool() {
  console.log('\n[TEST 1] ExifTool')
  console.log('-'.repeat(60))

  const exiftoolPath = getExiftoolPath()
  if (!exiftoolPath) {
    console.log('❌ ExifTool không tìm thấy')
    return false
  }

  console.log(`✓ ExifTool tìm thấy: ${exiftoolPath}`)

  // Tạo file backup
  const backupPath = testFile + '.backup'
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath)
  }
  fs.copyFileSync(testFile, backupPath)
  console.log(`✓ Đã tạo backup: ${backupPath}`)

  // Đọc metadata trước
  console.log('\n📖 Metadata TRƯỚC khi ghi:')
  const before = await readMetadata(testFile)
  console.log(`  Title: ${before.Title || '(không có)'}`)
  console.log(`  Keywords: ${before.Keywords || '(không có)'}`)
  console.log(`  Rating: ${before.Rating || '(không có)'}`)
  console.log(`  XMP:Keywords: ${before['XMP:Keywords'] || '(không có)'}`)
  console.log(`  QuickTime:Keywords: ${before['QuickTime:Keywords'] || '(không có)'}`)

  // Ghi metadata - dùng arg-file như code thực tế
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-seo-'))
  const tempFile = path.join(tempDir, path.basename(testFile))
  fs.copyFileSync(testFile, tempFile)

  // Tạo arg-file UTF-8
  const argFile = path.join(tempDir, 'args.txt')
  const argLines = [
    '-charset',
    'filename=utf8',
    '-charset',
    'exiftool=utf8',
    '-charset',
    'iptc=utf8',
    '-charset',
    'quicktime=utf8',
    `-Title=${testTitle}`,
    `-Keywords=${testTags}`,
    `-Rating=${testRating}`,
    `-XMP:Keywords=${testTags}`,
    `-QuickTime:Keywords=${testTags}`,
    `-Microsoft:Keywords=${testTags}`,
    '-overwrite_original',
    tempFile,
  ]
  await fs.promises.writeFile(argFile, argLines.join('\n'), { encoding: 'utf8' })

  const result = await runCommand(exiftoolPath, ['-@', argFile])
  if (!result.success) {
    console.log(`❌ ExifTool ghi lỗi: ${result.error}`)
    fs.unlinkSync(backupPath)
    return false
  }

  // Copy về file gốc
  fs.copyFileSync(tempFile, testFile)
  await fs.promises.rm(tempDir, { recursive: true })

  // Đọc metadata sau
  console.log('\n📖 Metadata SAU khi ghi:')
  const after = await readMetadata(testFile)
  console.log(`  Title: ${after.Title || '(không có)'}`)
  console.log(`  Keywords: ${after.Keywords || '(không có)'}`)
  console.log(`  Rating: ${after.Rating || '(không có)'}`)
  console.log(`  XMP:Keywords: ${after['XMP:Keywords'] || '(không có)'}`)
  console.log(`  QuickTime:Keywords: ${after['QuickTime:Keywords'] || '(không có)'}`)

  // Kiểm tra kết quả
  const titleOk = after.Title === testTitle
  const keywordsOk = after.Keywords === testTags || after['XMP:Keywords'] === testTags || after['QuickTime:Keywords'] === testTags
  const ratingOk = after.Rating === testRating || after.Rating === '5' || after['Microsoft:RatingPercent'] === testRating

  console.log('\n📊 Kết quả:')
  console.log(`  Title: ${titleOk ? '✓' : '✗'}`)
  console.log(`  Keywords/Tags: ${keywordsOk ? '✓' : '✗'}`)
  console.log(`  Rating: ${ratingOk ? '✓' : '✗'}`)

  // Restore backup
  fs.copyFileSync(backupPath, testFile)
  fs.unlinkSync(backupPath)
  console.log(`✓ Đã restore từ backup`)

  return titleOk && keywordsOk && ratingOk
}

async function testFfmpeg() {
  console.log('\n[TEST 2] FFmpeg')
  console.log('-'.repeat(60))

  const paths = getFfmpegPaths()
  if (!paths.ffmpeg || !fs.existsSync(paths.ffmpeg)) {
    console.log('❌ FFmpeg không tìm thấy')
    return false
  }

  console.log(`✓ FFmpeg tìm thấy: ${paths.ffmpeg}`)

  // Tạo file backup
  const backupPath = testFile + '.backup2'
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath)
  }
  fs.copyFileSync(testFile, backupPath)
  console.log(`✓ Đã tạo backup: ${backupPath}`)

  // Đọc metadata trước (dùng ffprobe)
  console.log('\n📖 Metadata TRƯỚC khi ghi:')
  const probeBefore = await runCommand(paths.ffprobe, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    testFile,
  ])
  if (probeBefore.success) {
    try {
      const format = JSON.parse(probeBefore.output).format
      console.log(`  title: ${format.tags?.title || '(không có)'}`)
      console.log(`  comment: ${format.tags?.comment || '(không có)'}`)
      console.log(`  rating: ${format.tags?.rating || '(không có)'}`)
    } catch {}
  }

  // Ghi metadata
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-seo-ffmpeg-'))
  const tempFile = path.join(tempDir, path.basename(testFile))

  const args = [
    '-i',
    testFile,
    '-c',
    'copy',
    '-metadata',
    `title=${testTitle}`,
    '-metadata',
    `keywords=${testTags}`,
    '-metadata',
    `rating=${testRating}`,
    '-y',
    tempFile,
  ]

  const result = await runCommand(paths.ffmpeg, args)
  if (!result.success) {
    console.log(`❌ FFmpeg ghi lỗi: ${result.error.substring(0, 500)}`)
    fs.unlinkSync(backupPath)
    return false
  }

  // Copy về file gốc
  fs.copyFileSync(tempFile, testFile)
  await fs.promises.rm(tempDir, { recursive: true })

  // Đọc metadata sau
  console.log('\n📖 Metadata SAU khi ghi:')
  const probeAfter = await runCommand(paths.ffprobe, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    testFile,
  ])
  let titleOk = false
  let keywordsOk = false
  let ratingOk = false

  if (probeAfter.success) {
    try {
      const format = JSON.parse(probeAfter.output).format
      const title = format.tags?.title
      const keywords = format.tags?.keywords
      const rating = format.tags?.rating

      console.log(`  title: ${title || '(không có)'}`)
      console.log(`  keywords: ${keywords || '(không có)'}`)
      console.log(`  rating: ${rating || '(không có)'}`)

      titleOk = title === testTitle
      keywordsOk = keywords === testTags
      ratingOk = rating === testRating || rating === '100'
    } catch {}
  }

  console.log('\n📊 Kết quả:')
  console.log(`  Title: ${titleOk ? '✓' : '✗'}`)
  console.log(`  Keywords/Tags: ${keywordsOk ? '✓' : '✗'}`)
  console.log(`  Rating: ${ratingOk ? '✓' : '✗'}`)

  // Restore backup
  fs.copyFileSync(backupPath, testFile)
  fs.unlinkSync(backupPath)
  console.log(`✓ Đã restore từ backup`)

  return titleOk && keywordsOk && ratingOk
}

async function testWindowsPropertySystem() {
  console.log('\n[TEST 3] Windows Property System (PowerShell)')
  console.log('-'.repeat(60))

  if (process.platform !== 'win32') {
    console.log('⚠️ Chỉ chạy trên Windows')
    return false
  }

  // Tạo file backup
  const backupPath = testFile + '.backup3'
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath)
  }
  fs.copyFileSync(testFile, backupPath)
  console.log(`✓ Đã tạo backup: ${backupPath}`)

  const script = `
param([string]$Path, [string]$Title, [string]$Tags, [string]$Rating)

$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path $Path))
$file = $folder.ParseName((Split-Path $Path -Leaf))

function SetProp($id, $value) {
  if ($value -ne $null -and $value -ne '') {
    try {
      $folder.SetDetailsOf($file, $id, $value) | Out-Null
      Write-Host "Set property ID $id = $value"
    } catch {
      Write-Host "Failed to set property ID $id : $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

SetProp 21 $Title  # Title
SetProp 18 $Tags   # Tags
SetProp 19 $Rating # Rating
`

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-seo-ps-'))
  const psPath = path.join(tempDir, 'test.ps1')
  await fs.promises.writeFile(psPath, script, { encoding: 'utf8' })

  // Đọc metadata trước (qua PowerShell)
  const readBefore = await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace('${path.dirname(testFile)}'); $file = $folder.ParseName('${path.basename(testFile)}'); Write-Host "Title: $($folder.GetDetailsOf($file, 21))"; Write-Host "Tags: $($folder.GetDetailsOf($file, 18))"; Write-Host "Rating: $($folder.GetDetailsOf($file, 19))"`,
  ])

  console.log('\n📖 Metadata TRƯỚC khi ghi:')
  console.log(readBefore.output)

  // Ghi metadata
  const result = await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    psPath,
    '-Path',
    testFile,
    '-Title',
    testTitle,
    '-Tags',
    testTags,
    '-Rating',
    '5', // Windows dùng 0-5
  ])

  if (!result.success) {
    console.log(`❌ PowerShell ghi lỗi: ${result.error}`)
    fs.unlinkSync(backupPath)
    return false
  }

  console.log(result.output)

  // Đọc metadata sau
  const readAfter = await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace('${path.dirname(testFile)}'); $file = $folder.ParseName('${path.basename(testFile)}'); Write-Host "Title: $($folder.GetDetailsOf($file, 21))"; Write-Host "Tags: $($folder.GetDetailsOf($file, 18))"; Write-Host "Rating: $($folder.GetDetailsOf($file, 19))"`,
  ])

  console.log('\n📖 Metadata SAU khi ghi:')
  console.log(readAfter.output)

  // Parse kết quả
  const titleMatch = readAfter.output.match(/Title:\s*(.+)/)
  const tagsMatch = readAfter.output.match(/Tags:\s*(.+)/)
  const ratingMatch = readAfter.output.match(/Rating:\s*(.+)/)

  const titleOk = titleMatch && titleMatch[1].trim() === testTitle
  const tagsOk = tagsMatch && tagsMatch[1].trim() === testTags
  const ratingOk = ratingMatch && ratingMatch[1].trim() === '5'

  console.log('\n📊 Kết quả:')
  console.log(`  Title: ${titleOk ? '✓' : '✗'}`)
  console.log(`  Tags: ${tagsOk ? '✓' : '✗'}`)
  console.log(`  Rating: ${ratingOk ? '✓' : '✗'}`)

  // Restore backup
  fs.copyFileSync(backupPath, testFile)
  fs.unlinkSync(backupPath)
  await fs.promises.rm(tempDir, { recursive: true })
  console.log(`✓ Đã restore từ backup`)

  return titleOk && tagsOk && ratingOk
}

async function main() {
  const results: {
    exiftool: boolean
    ffmpeg: boolean
    windows: boolean
  } = {
    exiftool: false,
    ffmpeg: false,
    windows: false,
  }

  try {
    const result = await testExiftool()
    results.exiftool = result || false
  } catch (err: any) {
    console.log(`❌ Test ExifTool lỗi: ${err.message}`)
    results.exiftool = false
  }

  try {
    const result = await testFfmpeg()
    results.ffmpeg = result || false
  } catch (err: any) {
    console.log(`❌ Test FFmpeg lỗi: ${err.message}`)
    results.ffmpeg = false
  }

  try {
    const result = await testWindowsPropertySystem()
    results.windows = result || false
  } catch (err: any) {
    console.log(`❌ Test Windows Property System lỗi: ${err.message}`)
    results.windows = false
  }

  console.log('\n' + '='.repeat(60))
  console.log('TÓM TẮT KẾT QUẢ')
  console.log('='.repeat(60))
  console.log(`ExifTool:     ${results.exiftool ? '✓ HOẠT ĐỘNG' : '✗ KHÔNG HOẠT ĐỘNG'}`)
  console.log(`FFmpeg:       ${results.ffmpeg ? '✓ HOẠT ĐỘNG' : '✗ KHÔNG HOẠT ĐỘNG'}`)
  console.log(`Windows PS:   ${results.windows ? '✓ HOẠT ĐỘNG' : '✗ KHÔNG HOẠT ĐỘNG'}`)
  console.log('='.repeat(60))
}

main().catch(console.error)

