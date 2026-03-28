# SEO Metadata Code Analysis

## File: `backend/video/seoMetadata.ts`

### Full Source Code

```typescript
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'child_process'

export interface SeoMetadataRequest {
  files: Array<{ path: string; title: string }>
  mode: 'title' | 'genre'
  channelName: string
  channelUrl: string
  genre: string
}

export interface SeoMetadataResult {
  file: string
  success: boolean
  error?: string
}

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

function buildExiftoolArgs(req: SeoMetadataRequest, file: { path: string; title: string }): string[] {
  const baseTitle = file.title || path.basename(file.path)
  const useGenre = req.mode === 'genre'
  const genreValue = useGenre ? req.genre : ''
  const yearValue = useGenre ? new Date().getFullYear().toString() : ''
  const source = useGenre ? genreValue : baseTitle
  const channel = req.channelName
  const url = req.channelUrl
  const titleValue = useGenre ? genreValue : baseTitle

  const pairs: Array<[string, string]> = []

  // Description
  pairs.push(
    ['-Title', titleValue],
    ['-XMP:Title', titleValue],
    ['-QuickTime:Title', titleValue],
    ['-Microsoft:Title', titleValue],
    ['-XPTitle', titleValue],
    ['-Subject', titleValue],
    ['-XMP:Subject', source],
    ['-Microsoft:Subject', source],
    ['-Comment', titleValue],
    ['-QuickTime:Comment', titleValue],
    ['-Microsoft:Comment', titleValue],
    ['-XPComment', titleValue],
    ['-Description', titleValue],
    ['-XMP:Description', titleValue],
    ['-Subtitle', titleValue],
    ['-Keywords', source],
    ['-XMP:Keywords', source],
    ['-XMP:TagsList', source],
    ['-QuickTime:Keywords', source],
    ['-Microsoft:Keywords', source],
    ['-XPKeywords', source]
  )

  // Media (only when mode = genre)
  if (useGenre) {
    pairs.push(
      ['-Genre', genreValue],
      ['-XMP:Genre', genreValue],
      ['-QuickTime:Genre', genreValue],
      ['-WM/Genre', genreValue],
      ['-Year', yearValue],
      ['-XMP:Year', yearValue],
      ['-QuickTime:Year', yearValue],
      ['-WM/Year', yearValue],
      ['-Date', yearValue],
      ['-ContentCreateDate', yearValue],
      ['-ContributingArtists', genreValue],
      ['-WM/AlbumArtist', genreValue]
    )
  }

  // Rating 5 sao
  pairs.push(
    ['-Rating', '5'],
    ['-XMP:Rating', '5'],
    ['-QuickTime:Rating', '5'],
    ['-Microsoft:RatingPercent', '99'],
    ['-Microsoft:Rating', '99'],
    ['-RatingPercent', '99']
  )

  // Origin
  pairs.push(
    ['-Director', channel],
    ['-QuickTime:Director', channel],
    ['-WM/Director', channel],
    ['-Producer', channel],
    ['-QuickTime:Producer', channel],
    ['-WM/Producer', channel],
    ['-Writer', source],
    ['-XMP:Writer', source],
    ['-QuickTime:Writer', source],
    ['-WM/Writer', source],
    ['-Publisher', source],
    ['-QuickTime:Publisher', source],
    ['-WM/Publisher', source],
    ['-ContentProvider', source],
    ['-EncodedBy', source],
    ['-QuickTime:EncodedBy', source],
    ['-WM/EncodedBy', source],
    ['-Author', channel],
    ['-XMP:Author', channel],
    ['-XMP:Creator', channel],
    ['-Microsoft:Author', channel],
    ['-XPAuthor', channel]
  )

  // URLs: Author/Promotion URL dùng tên kênh, URL dùng link kênh nếu có
  pairs.push(
    ['-AuthorURL', channel],
    ['-PromotionURL', channel],
    ['-URL', url || channel],
    ['-XMP:AuthorURL', channel],
    ['-XMP:PromotionURL', channel],
    ['-XMP:URL', url || channel],
    ['-WM/AuthorURL', channel]
  )

  // Content (bỏ Parental rating reason)
  pairs.push(
    ['-ParentalRating', source],
    ['-WM/ParentalRating', source],
    ['-Conductor', source],
    ['-WM/Conductor', source],
    ['-Mood', source],
    ['-Period', source],
    ['-PartOfSet', source],
    ['-InitialKey', source],
    ['-BeatsPerMinute', source],
    ['-Protected', 'No']
  )

  const args: string[] = []
  for (const [k, v] of pairs) {
    if (v && v.length > 0) {
      args.push(`${k}=${v}`)
    }
  }

  args.push('-overwrite_original')
  // Charset để ghi Unicode đầy đủ
  args.unshift(
    '-charset',
    'filename=utf8',
    '-charset',
    'exiftool=utf8',
    '-charset',
    'iptc=utf8',
    '-charset',
    'quicktime=utf8',
    '-charset',
    'id3=utf8',
    '-codedcharacterset=utf8'
  )
  args.push(file.path)
  return args
}

async function applyWithWindowsPropertySystem(req: SeoMetadataRequest, file: { path: string; title: string }) {
  const baseTitle = file.title || path.basename(file.path)
  const titleValue = req.mode === 'genre' ? req.genre : baseTitle
  const subjectValue = titleValue
  const commentValue = titleValue
  const stars = 5 // mặc định 5 sao, Explorer cột 19 nhận chuỗi "0".."5"

  // Viết script PowerShell ra file tạm rồi gọi với tham số để tránh lỗi Unicode.
  const script = `
param(
  [string]$Path,
  [string]$Title,
  [string]$Subject,
  [string]$Comment,
  [int]$Stars
)

# clamp 0..5
if ($Stars -lt 0) { $Stars = 0 }
if ($Stars -gt 5) { $Stars = 5 }

$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path $Path))
$file   = $folder.ParseName((Split-Path $Path -Leaf))

function SetProp($fileObj, $id, $value) {
  if ($value -ne $null -and $value -ne '') {
    $folder.SetDetailsOf($fileObj, $id, $value) | Out-Null
  }
}

# Tìm index Subtitle nếu có, nếu không fallback Subject (22)
function GetColumnIndexByName($fld, $targetName) {
  for ($i = 0; $i -lt 300; $i++) {
    $n = $fld.GetDetailsOf($null, $i)
    if ($n -and $n -eq $targetName) { return $i }
  }
  return -1
}

$titleId = 21
$subjectId = 22
$commentId = 24
$ratingId = 19
$subtitleId = GetColumnIndexByName $folder 'Subtitle'
if ($subtitleId -eq -1) { $subtitleId = $subjectId }

SetProp $file $titleId $Title
SetProp $file $subjectId $Subject
SetProp $file $subtitleId $Subject
SetProp $file $commentId $Comment
SetProp $file $ratingId ([string]$Stars)
`

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-ps-'))
  const psPath = path.join(tempDir, 'setmeta.ps1')
  await fs.promises.writeFile(psPath, script, { encoding: 'utf8' })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        psPath,
        '-Path',
        file.path,
        '-Title',
        titleValue,
        '-Subject',
        subjectValue,
        '-Comment',
        commentValue,
        '-Stars',
        `${stars}`,
      ],
      { windowsHide: true }
    )
    let stderr = ''
    proc.stderr?.on('data', (buf) => (stderr += buf.toString()))
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `PowerShell exited ${code}`))
    })
  })

  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  return true
}

async function applyMetadataWithExiftool(
  exiftoolPath: string,
  req: SeoMetadataRequest,
  file: { path: string; title: string }
) {
  // 1) Chạy exiftool trên bản copy, rồi copy ngược về file gốc
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-exif-'))
  const ext = path.extname(file.path) || '.mp4'
  const tempPath = path.join(tempDir, `temp${ext}`)
  await fs.promises.copyFile(file.path, tempPath)

  const args = buildExiftoolArgs(req, { ...file, path: tempPath })

  // Trên Windows, exiftool không nhận Unicode tốt qua argv.
  // Ghi arg-file UTF-8 và dùng -@ để đảm bảo chuỗi không bị mất dấu.
  const argFilePath = path.join(tempDir, 'args.txt')
  await fs.promises.writeFile(argFilePath, args.join('\n'), { encoding: 'utf8' })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(exiftoolPath, ['-@', argFilePath], {
      windowsHide: true,
      cwd: path.dirname(exiftoolPath), // để exiftool tìm thấy exiftool_files/*
    })
    let stderr = ''
    proc.stderr?.on('data', (buf) => {
      stderr += buf.toString()
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`exiftool exited with code ${code}. stderr: ${stderr}`))
    })
  })

  // Ghi đè file gốc
  await fs.promises.copyFile(tempPath, file.path)
  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})

  // 2) Sau khi file đã hoàn chỉnh, nếu Windows thì set 4 field Explorer bằng PowerShell
  if (process.platform === 'win32') {
    await applyWithWindowsPropertySystem(req, file).catch(() => false)
  }
}

export async function applySeoMetadata(req: SeoMetadataRequest): Promise<SeoMetadataResult[]> {
  const results: SeoMetadataResult[] = []
  const exiftoolPath = getExiftoolPath()
  if (!exiftoolPath) {
    return req.files.map((f) => ({
      file: f.path,
      success: false,
      error: 'Không tìm thấy exiftool.exe trong bin/. Vui lòng đặt exiftool.exe vào bin/ rồi thử lại.',
    }))
  }

  for (const file of req.files) {
    try {
      await applyMetadataWithExiftool(exiftoolPath, req, file)
      results.push({ file: file.path, success: true })
    } catch (err: any) {
      results.push({ file: file.path, success: false, error: err?.message || String(err) })
    }
  }
  return results
}
```

---

## Phân tích Implementation

### 1. Exiftool Usage
- **Cách dùng**: Sử dụng `child_process.spawn` để chạy exiftool executable (không dùng library)
- **Path resolution**: Tìm exiftool trong:
  - `process.cwd()/bin/exiftool.exe`
  - `process.cwd()/bin/exiftool`
  - `resourcesPath/bin/exiftool.exe` (khi build app)
- **Unicode handling**: Dùng arg-file (`-@ args.txt`) với encoding UTF-8 để tránh mất dấu trên Windows
- **Workflow**: Copy file → Apply metadata trên copy → Copy lại file gốc → Cleanup

### 2. Windows Property System
- **Trường xử lý** (qua PowerShell + Shell.Application COM):
  - **Title** (ID: 21)
  - **Subject** (ID: 22)
  - **Subtitle** (dynamic index, fallback Subject)
  - **Comment** (ID: 24)
  - **Rating** (ID: 19) - mặc định 5 sao
- **Thứ tự**: Chạy sau khi exiftool hoàn thành
- **Error handling**: `.catch(() => false)` - nếu PowerShell fail thì vẫn coi như thành công (vì exiftool đã ghi xong)

### 3. Metadata Fields được ghi

#### A. Description Fields (luôn ghi):
- Title (nhiều format: XMP, QuickTime, Microsoft, XP)
- Subject
- Comment
- Description
- Subtitle
- Keywords/Tags

#### B. Media Fields (chỉ khi mode = 'genre'):
- Genre
- Year
- Date/ContentCreateDate
- ContributingArtists
- AlbumArtist

#### C. Rating (luôn ghi):
- Rating = 5 (nhiều format)
- RatingPercent = 99

#### D. Origin/Creator Fields (luôn ghi):
- Director = channelName
- Producer = channelName
- Writer = source (title hoặc genre)
- Publisher = source
- ContentProvider = source
- EncodedBy = source
- Author = channelName

#### E. URL Fields (luôn ghi):
- AuthorURL = channelName
- PromotionURL = channelName
- URL = channelUrl (hoặc channelName nếu không có URL)

#### F. Content Fields (luôn ghi):
- ParentalRating
- Conductor
- Mood
- Period
- PartOfSet
- InitialKey
- BeatsPerMinute
- Protected = 'No'

### 4. Verification
- **Hiện tại**: KHÔNG có verify metadata sau khi apply
- **Chỉ check**: Exit code của exiftool (0 = success, khác 0 = error)

### 5. Error Handling
- Exiftool không tìm thấy → return error cho tất cả files
- Exiftool fail → catch error, return `{ success: false, error: message }`
- PowerShell fail → catch và ignore (vì exiftool đã ghi xong)

### 6. File Format Support
- Code không giới hạn format cụ thể
- Exiftool hỗ trợ: MP4, MKV, AVI, MOV, v.v.
- Windows Property System chỉ hoạt động trên Windows

---

## Potential Issues & Questions

### 1. **Unicode/Encoding**
- ✅ Đã xử lý Unicode qua arg-file UTF-8
- ❓ Test với tiếng Việt có dấu chưa?

### 2. **File Locking**
- ⚠️ Copy file → apply → copy lại có thể gặp file lock nếu file đang mở
- ❓ Có handle file lock exception không?

### 3. **Large Files**
- ⚠️ Copy toàn bộ file vào temp có thể tốn disk space với file lớn
- ❓ Có check disk space trước khi copy không?

### 4. **Metadata Verification**
- ❌ Không có verify sau khi apply
- ❓ Có thể thêm `exiftool -s -s -s file.mp4` để đọc lại và verify?

### 5. **Windows Property System**
- ⚠️ Chỉ set 5 trường (Title, Subject, Comment, Rating, Subtitle)
- ❓ Có cần set thêm trường nào khác không?

### 6. **Error Messages**
- ⚠️ Error message từ exiftool stderr có thể không user-friendly
- ❓ Có parse và format error message không?

---

## Suggested Improvements

1. **Add metadata verification** sau khi apply
2. **Better error parsing** từ exiftool stderr
3. **Progress callback** để update UI realtime
4. **File format validation** trước khi apply
5. **Disk space check** trước khi copy file
6. **Retry mechanism** nếu file lock

---

## Test Cases Needed

1. ✅ MP4 với tiếng Việt có dấu
2. ✅ MKV format
3. ✅ File lớn (>1GB)
4. ✅ File đang mở trong player
5. ✅ File read-only
6. ✅ File không có quyền write
7. ✅ Exiftool không tồn tại
8. ✅ PowerShell execution policy restricted

