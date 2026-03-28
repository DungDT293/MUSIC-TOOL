import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'

export interface SeoMetadataRequest {
  files: Array<{ path: string; title: string }>
  mode: 'title' | 'genre'
  channelName: string
  channelUrl: string
  genre: string
  tags: string // Tags do người dùng nhập
}

export interface SeoMetadataResult {
  file: string
  success: boolean
  error?: string
}

// ===== HELPER FUNCTIONS =====

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

function getAtomicParsleyPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'bin', 'AtomicParsley.exe'),
    path.join(process.cwd(), 'bin', 'AtomicParsley'),
    path.join((process as any).resourcesPath || '', 'bin', 'AtomicParsley.exe'),
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

// ===== ATOMICPARSLEY (iTunes atoms - QUAN TRỌNG NHẤT) =====

async function applyAtomicParsleyMetadata(
  atomicParsleyPath: string,
  req: SeoMetadataRequest,
  file: { path: string; title: string }
): Promise<void> {
  const baseTitle = file.title || path.basename(file.path)
  const useGenre = req.mode === 'genre'
  const titleValue = useGenre ? req.genre : baseTitle
  const channel = req.channelName
  const url = req.channelUrl || channel
  const genreValue = useGenre ? req.genre : ''
  const year = new Date().getFullYear().toString()
  const source = useGenre ? genreValue : baseTitle

  // Copy file to temp
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-ap-'))
  const ext = path.extname(file.path) || '.mp4'
  const tempPath = path.join(tempDir, `temp${ext}`)
  await fs.promises.copyFile(file.path, tempPath)

  // CHỈ GHI DESCRIPTION - các phần khác không cần
  const args = [
    tempPath,
    '--overWrite',
    '--description',
    titleValue,
    '--longdesc',
    titleValue,
  ]

  let atomicParsleySuccess = false
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(atomicParsleyPath, args, {
      windowsHide: true,
      // Ensure UTF-8 encoding for Unicode support (Vietnamese, Chinese, Japanese, Indonesian, etc.)
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stderr = ''
    proc.stderr?.on('data', (buf) => {
      stderr += buf.toString('utf8')
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) {
        atomicParsleySuccess = true
        resolve()
      } else {
        // Nếu lỗi do file structure (atom moov lớn hơn file size), skip AtomicParsley và tiếp tục với Exiftool
        if (stderr.includes('atom was detected that presents as larger than filesize') || 
            stderr.includes('atom moov') ||
            stderr.includes('filesize') ||
            stderr.includes('Aborting')) {
          console.warn('[SEO] AtomicParsley failed due to file structure issue, skipping iTunes atoms. Will use Exiftool only.')
          // Không reject, chỉ resolve để tiếp tục với Exiftool
          // Không copy file về vì AtomicParsley đã fail
          resolve()
        } else {
          reject(new Error(`AtomicParsley exited ${code}. stderr: ${stderr}`))
        }
      }
    })
  })

  // Chỉ copy file về nếu AtomicParsley thành công
  if (atomicParsleySuccess) {
    await fs.promises.copyFile(tempPath, file.path)
  }
  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
}

// ===== EXIFTOOL (Extended tags) =====

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
  
  // Xử lý tags: join multi-line thành một string, loại bỏ dòng trống
  let tagsValue = (req.tags || '').trim()
  if (tagsValue) {
    // Nếu tags có nhiều dòng, join lại bằng dấu phẩy
    const tagsLines = tagsValue.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    tagsValue = tagsLines.join(', ')
  }

  // Title, Subtitle, Comments = tiêu đề video (hoặc thể loại tùy mode)
  pairs.push(
    ['-Title', titleValue],
    ['-XMP:Title', titleValue],
    ['-QuickTime:Title', titleValue],
    ['-Subtitle', titleValue],
    ['-XMP:Subtitle', titleValue],
    ['-QuickTime:Subtitle', titleValue],
    ['-Comment', titleValue],
    ['-QuickTime:Comment', titleValue],
    ['-Description', titleValue],
    ['-XMP:Description', titleValue],
    ['-QuickTime:Description', titleValue],
  )

  // Tags = từ user input - CHỈ DÙNG CÁC TAG HỢP LỆ
  if (tagsValue) {
    pairs.push(
      // Keywords (chuẩn nhất - hỗ trợ tốt)
      ['-Keywords', tagsValue],
      ['-XMP:Keywords', tagsValue],
      ['-XMP:TagsList', tagsValue],
      ['-QuickTime:Keywords', tagsValue],
      ['-XPKeywords', tagsValue],
      // Subject cũng có thể chứa tags
      ['-Subject', tagsValue],
      ['-XMP:Subject', tagsValue]
    )
  }

  // Rating 5 sao - CHỈ DÙNG CÁC TAG HỢP LỆ
  pairs.push(
    ['-Rating', '100'], // Rating chuẩn (5 sao = 100)
    ['-XMP:Rating', '5'], // XMP standard (5 sao = 5)
    ['-QuickTime:Rating', '5'] // QuickTime standard (5 sao = 5)
  )

  const args: string[] = []
  for (const [k, v] of pairs) {
    if (v && v.length > 0) {
      args.push(`${k}=${v}`)
    }
  }

  args.push('-overwrite_original')

  // Charset for Unicode
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

async function applyExiftoolMetadata(
  exiftoolPath: string,
  req: SeoMetadataRequest,
  file: { path: string; title: string }
): Promise<void> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-exif-'))
  const ext = path.extname(file.path) || '.mp4'
  const tempPath = path.join(tempDir, `temp${ext}`)
  await fs.promises.copyFile(file.path, tempPath)

  const args = buildExiftoolArgs(req, { ...file, path: tempPath })

  const argFilePath = path.join(tempDir, 'args.txt')
  await fs.promises.writeFile(argFilePath, args.join('\n'), { encoding: 'utf8' })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(exiftoolPath, ['-@', argFilePath], {
      windowsHide: true,
      cwd: path.dirname(exiftoolPath),
    })
    let stderr = ''
    proc.stderr?.on('data', (buf) => {
      stderr += buf.toString()
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`exiftool exited ${code}. stderr: ${stderr}`))
    })
  })

  await fs.promises.copyFile(tempPath, file.path)
  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
}

// ===== WINDOWS PROPERTY SYSTEM (PowerShell) =====

async function applyWithWindowsPropertySystem(
  req: SeoMetadataRequest,
  file: { path: string; title: string }
): Promise<void> {
  const baseTitle = file.title || path.basename(file.path)
  const useGenre = req.mode === 'genre'
  const titleValue = useGenre ? req.genre : baseTitle
  const genreValue = useGenre ? req.genre : ''
  // Year luôn có giá trị (không để empty)
  const year = new Date().getFullYear().toString()
  // Genre luôn có giá trị (nếu empty thì dùng title)
  const finalGenre = useGenre ? genreValue : titleValue
  const channel = req.channelName
  const source = useGenre ? genreValue : baseTitle
  const stars = 5

  const script = `
param(
  [string]$Path,
  [string]$Title,
  [string]$Subtitle,
  [string]$Tags,
  [string]$Comment
)

$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path $Path))
$file = $folder.ParseName((Split-Path $Path -Leaf))

# Function để tìm property ID bằng tên (dynamic lookup)
function GetColumnIndexByName($fld, $targetName) {
  for ($i = 0; $i -lt 300; $i++) {
    $n = $fld.GetDetailsOf($null, $i)
    if ($n -and $n -eq $targetName) { return $i }
  }
  return -1
}

function SetProp($id, $value) {
  if ($value -ne $null -and $value -ne '') {
    try {
      $result = $folder.SetDetailsOf($file, $id, $value)
      # Force refresh để Windows Explorer nhận giá trị mới
      if ($result -eq $null) {
        # SetDetailsOf thành công
      }
    } catch {
      # Log error nhưng không throw để tiếp tục set các property khác
      Write-Host "Warning: Failed to set property ID $id : $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

# Function để set property bằng tên (dynamic lookup)
function SetPropByName($propName, $value) {
  if ($value -ne $null -and $value -ne '') {
    $id = GetColumnIndexByName $folder $propName
    if ($id -ge 0) {
      try {
        $folder.SetDetailsOf($file, $id, $value) | Out-Null
      } catch {
        Write-Host "Warning: Failed to set property '$propName' (ID $id): $($_.Exception.Message)" -ForegroundColor Yellow
      }
    } else {
      Write-Host "Warning: Property '$propName' not found in folder namespace" -ForegroundColor Yellow
    }
  }
}

# Windows 10/11 Property Column IDs
# Title, Subtitle, Comments = tiêu đề video
SetProp 21 $Title          # Title *
SetPropByName "Title" $Title
SetProp 26 $Subtitle       # Subtitle *
SetPropByName "Subtitle" $Subtitle
SetProp 24 $Comment        # Comments *
SetPropByName "Comments" $Comment
SetPropByName "Description" $Comment

# Tags = từ user input
if ($Tags -ne '' -and $Tags -ne $null) {
  SetProp 18 $Tags           # Tags *
  SetPropByName "Tags" $Tags
  SetPropByName "Keywords" $Tags
}

# Rating 5 sao - PHẢI CÓ
SetProp 19 "5"               # Rating * - 5 sao
SetPropByName "Rating" "5"
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
        '-Subtitle',
        titleValue,
        '-Tags',
        tagsValue,
        '-Comment',
        titleValue,
        '-Rating',
        '5',
      ],
      {
        windowsHide: true,
        // Ensure UTF-8 encoding for Unicode support (Vietnamese, Chinese, Japanese, Indonesian, etc.)
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      }
    )
    let stderr = ''
    proc.stderr?.on('data', (buf) => (stderr += buf.toString('utf8')))
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `PowerShell exited ${code}`))
    })
  })

  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
}

// ===== FFMPEG (Bổ sung cho Tags và Rating) =====

async function applyFfmpegMetadata(
  req: SeoMetadataRequest,
  file: { path: string; title: string }
): Promise<void> {
  const paths = getFfmpegPaths()
  if (!paths.ffmpeg || !fs.existsSync(paths.ffmpeg)) {
    throw new Error('FFmpeg not found')
  }

  const baseTitle = file.title || path.basename(file.path)
  const useGenre = req.mode === 'genre'
  const titleValue = useGenre ? req.genre : baseTitle
  const tagsValue = req.tags || ''

  // Copy file to temp
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-ffmpeg-'))
  const ext = path.extname(file.path) || '.mp4'
  const tempPath = path.join(tempDir, `temp${ext}`)
  await fs.promises.copyFile(file.path, tempPath)

  const args = [
    '-i',
    tempPath,
    '-c',
    'copy', // Copy stream, không re-encode
    '-metadata',
    `title=${titleValue}`,
    '-metadata',
    `comment=${titleValue}`,
    '-metadata',
    `description=${titleValue}`,
    // Bỏ rating vì test cho thấy FFmpeg không ghi được rating
  ]

  // Tags - FFmpeg ghi Keywords tốt (test đã xác nhận)
  if (tagsValue) {
    args.push(
      '-metadata',
      `keywords=${tagsValue}`,
      '-metadata',
      `comment=${titleValue} | Tags: ${tagsValue}` // Thêm tags vào comment
    )
  }

  args.push('-y') // Overwrite output file
  args.push(file.path)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(paths.ffmpeg, args, {
      windowsHide: true,
      env: { ...process.env },
    })
    let stderr = ''
    proc.stderr?.on('data', (buf) => {
      stderr += buf.toString('utf8')
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited ${code}. stderr: ${stderr.substring(0, 500)}`))
    })
  })

  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
}

// ===== MAIN WORKFLOW =====

async function applyMetadataComplete(
  req: SeoMetadataRequest,
  file: { path: string; title: string }
): Promise<void> {
  const exiftoolPath = getExiftoolPath()
  const paths = getFfmpegPaths()
  const hasFfmpeg = paths.ffmpeg && fs.existsSync(paths.ffmpeg)

  // STEP 1: Exiftool (chính - ghi metadata chi tiết: Title, Subtitle, Comments, Tags, Rating)
  // Exiftool hỗ trợ tốt nhất cho tất cả metadata fields
  if (exiftoolPath) {
    console.log('[SEO] Applying Exiftool metadata...')
    try {
      await applyExiftoolMetadata(exiftoolPath, req, file)
    } catch (err: any) {
      console.warn('[SEO] Exiftool failed:', err.message)
      // Tiếp tục với FFmpeg nếu có
      if (!hasFfmpeg) throw err
    }
  }

  // STEP 2: FFmpeg (bổ sung - chỉ cho Tags nếu Exiftool không có)
  // Test cho thấy: FFmpeg ghi Title và Keywords tốt, nhưng Rating không được ghi
  // Chỉ dùng FFmpeg nếu không có Exiftool (fallback)
  if (!exiftoolPath && hasFfmpeg) {
    console.log('[SEO] Exiftool not found, using FFmpeg as fallback...')
    try {
      await applyFfmpegMetadata(req, file)
    } catch (err: any) {
      console.warn('[SEO] FFmpeg failed:', err.message)
      throw err // Throw vì đây là fallback duy nhất
    }
  }

  // Bỏ Windows Property System vì không hoạt động (SetDetailsOf method không tồn tại)
  // Test cho thấy: "Method invocation failed because [System.__ComObject] does not contain a method named 'SetDetailsOf'"
  // Exiftool và FFmpeg đã đủ để ghi metadata vào file

  // Nếu không có tool nào
  if (!exiftoolPath && !hasFfmpeg) {
    throw new Error('Neither Exiftool nor FFmpeg found. Cannot apply metadata.')
  }
}

// ===== EXPORT =====

export async function applySeoMetadata(req: SeoMetadataRequest): Promise<SeoMetadataResult[]> {
  const results: SeoMetadataResult[] = []
  const atomicParsleyPath = getAtomicParsleyPath()
  const exiftoolPath = getExiftoolPath()

  // Validation & warnings
  const warnings: string[] = []
  if (!atomicParsleyPath) {
    warnings.push('⚠️ AtomicParsley.exe not found in bin/ - iTunes atoms will not be written')
  }
  if (!exiftoolPath) {
    warnings.push('⚠️ exiftool.exe not found in bin/ - Extended tags will not be written')
  }

  if (warnings.length > 0) {
    console.warn('[SEO] Warnings:\n' + warnings.join('\n'))
  }

  // At least one tool must be available
  if (!atomicParsleyPath && !exiftoolPath) {
    return req.files.map((f) => ({
      file: f.path,
      success: false,
      error: 'Both AtomicParsley and exiftool are missing. Please place them in bin/ folder.',
    }))
  }

  // Process each file
  for (const file of req.files) {
    try {
      await applyMetadataComplete(req, file)
      results.push({ file: file.path, success: true })
    } catch (err: any) {
      results.push({ file: file.path, success: false, error: err?.message || String(err) })
    }
  }

  return results
}
