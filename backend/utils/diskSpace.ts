import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIGABYTE = 1024 * 1024 * 1024

export interface DiskSpaceInfo {
  drive: string
  total: number
  free: number
}

export interface SpaceCheckResult {
  freeBytes: number
  requiredBytes: number
  enough: boolean
}

export async function getDiskSpace(targetPath: string): Promise<DiskSpaceInfo> {
  // FIX: Xử lý đúng đường dẫn, bao gồm network drive và UNC path
  let resolved: string
  try {
    resolved = path.resolve(targetPath || os.homedir())
  } catch (err) {
    // Nếu không resolve được, dùng home directory
    resolved = os.homedir()
  }

  if (process.platform === 'win32') {
    // FIX: Xử lý network drive (\\server\share) và UNC path
    let drive: string
    if (resolved.startsWith('\\\\')) {
      // Network drive: \\server\share -> lấy 2 ký tự đầu (\\)
      // Nhưng network drive không có drive letter, cần xử lý khác
      // Tạm thời dùng ổ C: làm fallback
      drive = 'C:'
      console.warn(`[diskSpace] Network drive detected (${resolved}), using C: as fallback`)
    } else {
      // Local drive: C:\path -> C:
      drive = resolved.slice(0, 2).toUpperCase()
      // Validate drive format (phải là X:)
      if (!/^[A-Z]:$/.test(drive)) {
        console.warn(`[diskSpace] Invalid drive format: ${drive}, using C: as fallback`)
        drive = 'C:'
      }
    }
    
    try {
      const { stdout } = await execFileAsync('wmic', [
        'logicaldisk',
        'where',
        `Caption='${drive}'`,
        'get',
        'FreeSpace,Size',
        '/value',
      ])
      const matches = Object.fromEntries(
        stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split('='))
      )
      const free = Number(matches.FreeSpace ?? 0)
      const total = Number(matches.Size ?? 0)
      if (Number.isFinite(free) && Number.isFinite(total) && free > 0 && total > 0) {
        return { drive, free, total }
      } else {
        console.warn(`[diskSpace] Invalid disk space values: free=${free}, total=${total}, trying fallback`)
      }
    } catch (err) {
      console.warn('[diskSpace] WMIC query failed, trying alternative method:', err)
    }
    
    // FIX: Thử dùng fs.statfs hoặc PowerShell để lấy disk space chính xác hơn
    try {
      // Thử dùng PowerShell để lấy disk space
      const { stdout } = await execFileAsync('powershell', [
        '-Command',
        `Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -eq '${drive}\\' } | Select-Object -ExpandProperty Used,Free | ForEach-Object { $_.Free }`
      ])
      const freeStr = stdout.trim()
      if (freeStr && !isNaN(Number(freeStr))) {
        const free = Number(freeStr)
        // PowerShell trả về bytes, nhưng cần verify
        if (free > 0) {
          // Thử lấy total từ WMIC lại
          try {
            const { stdout: wmicTotal } = await execFileAsync('wmic', [
              'logicaldisk',
              'where',
              `Caption='${drive}'`,
              'get',
              'Size',
              '/value',
            ])
            const totalMatch = wmicTotal.match(/Size=(\d+)/)
            const total = totalMatch ? Number(totalMatch[1]) : free * 10 // Estimate
            return { drive, free, total }
          } catch {
            return { drive, free, total: free * 10 } // Estimate total
          }
        }
      }
    } catch (psErr) {
      console.warn('[diskSpace] PowerShell method failed:', psErr)
    }
    
    // FIX: Fallback cuối cùng - dùng ổ C: nếu drive không hợp lệ
    if (drive !== 'C:') {
      console.warn(`[diskSpace] Cannot get space for ${drive}, trying C: as fallback`)
      try {
        const { stdout } = await execFileAsync('wmic', [
          'logicaldisk',
          'where',
          `Caption='C:'`,
          'get',
          'FreeSpace,Size',
          '/value',
        ])
        const matches = Object.fromEntries(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.split('='))
        )
        const free = Number(matches.FreeSpace ?? 0)
        const total = Number(matches.Size ?? 0)
        if (Number.isFinite(free) && Number.isFinite(total) && free > 0 && total > 0) {
          console.warn(`[diskSpace] Using C: disk space as fallback for ${drive}`)
          return { drive: 'C:', free, total }
        }
      } catch (fallbackErr) {
        console.warn('[diskSpace] C: fallback also failed:', fallbackErr)
      }
    }
    
    // Last resort: return OS memory (không chính xác nhưng ít nhất không crash)
    console.warn(`[diskSpace] All methods failed, using OS memory as last resort (not accurate)`)
    return {
      drive: 'C:',
      free: os.freemem(),
      total: os.totalmem(),
    }
  }

  // POSIX fallback using `df -k`
  try {
    const { stdout } = await execFileAsync('df', ['-k', resolved])
    const lines = stdout.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      const totalKb = Number(parts[1])
      const freeKb = Number(parts[3])
      if (Number.isFinite(totalKb) && Number.isFinite(freeKb)) {
        return {
          drive: resolved,
          total: totalKb * 1024,
          free: freeKb * 1024,
        }
      }
    }
  } catch (err) {
    console.warn('[diskSpace] df command failed, falling back to OS metrics:', err)
  }

  return {
    drive: resolved,
    free: os.freemem(),
    total: os.totalmem(),
  }
}

export function checkMinimumSpace(freeBytes: number, minGigabytes: number): SpaceCheckResult {
  const requiredBytes = minGigabytes * GIGABYTE
  return {
    freeBytes,
    requiredBytes,
    enough: freeBytes >= requiredBytes,
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function createDiskSpaceErrorMessage(
  info: DiskSpaceInfo,
  check: SpaceCheckResult,
  meta?: { tabName?: string; operation?: string; additionalInfo?: string }
): string {
  const parts = [
    '❌ CẢNH BÁO: Dung lượng ổ đĩa không đủ.',
    `Ổ: ${info.drive}`,
    `Còn trống: ${formatBytes(check.freeBytes)}.`,
    `Cần tối thiểu: ${formatBytes(check.requiredBytes)}.`,
  ]

  if (meta?.tabName) {
    parts.push(`Tab: ${meta.tabName}.`)
  }
  if (meta?.operation) {
    parts.push(`Tác vụ: ${meta.operation}.`)
  }
  if (meta?.additionalInfo) {
    parts.push(meta.additionalInfo)
  }

  return parts.join('\n')
}

// ═══════════════════════════════════════════════════════════════
// FIX C-02: Shared assertMinDiskSpace — fail-fast before spawning FFmpeg.
// Used by both autopilot AND manual export paths.
// ═══════════════════════════════════════════════════════════════

/**
 * Assert that `targetDir` has at least `requiredBytes` free space.
 * Throws a descriptive error (with drive letter, free vs required) if insufficient.
 *
 * @param requiredBytes  Estimated bytes needed (caller should add a safety margin)
 * @param targetDir      The directory to check (used to determine drive)
 * @param label          Human-readable operation label for the error message
 * @param marginPercent  Extra safety margin on top of requiredBytes (default 15%)
 */
export async function assertMinDiskSpace(
  requiredBytes: number,
  targetDir: string,
  label: string = 'Export',
  marginPercent: number = 15,
): Promise<void> {
  const info = await getDiskSpace(targetDir)
  const withMargin = Math.round(requiredBytes * (1 + marginPercent / 100))

  if (info.free < withMargin) {
    throw new Error(
      createDiskSpaceErrorMessage(info, {
        freeBytes: info.free,
        requiredBytes: withMargin,
        enough: false,
      }, {
        operation: label,
        additionalInfo: `Hãy dọn dung lượng ổ ${info.drive} trước khi tiếp tục.`,
      })
    )
  }
}

// ═══════════════════════════════════════════════════════════════
// FIX C-02: ENOSPC / disk-full error classifier.
// FFmpeg and Node.js emit various error patterns when the disk fills up.
// This centralizes detection so callers can react appropriately.
// ═══════════════════════════════════════════════════════════════

/** Patterns indicating disk-full in FFmpeg stderr or Node.js error messages */
const ENOSPC_PATTERNS = [
  'no space left on device',      // Linux / POSIX
  'enospc',                       // Node.js error code
  'not enough space',             // Windows (English)
  'không đủ dung lượng',          // Vietnamese
  'disk full',                    // Generic
  'there is not enough space',    // Windows (long form)
  'error number 28',              // errno 28 = ENOSPC on Linux
]

/**
 * Check if an error (from FFmpeg stderr, Node.js error, or generic string)
 * indicates the disk is full (ENOSPC).
 */
export function isEnospcError(error: unknown): boolean {
  // Check Node.js error code directly
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    if (err.code === 'ENOSPC') return true
    // errno 28 = ENOSPC on POSIX
    if (err.errno === -28 || err.errno === 28) return true
  }

  // Check string representation
  const msg = typeof error === 'string'
    ? error.toLowerCase()
    : error instanceof Error
      ? (error.message + ' ' + (error as any).stderr).toLowerCase()
      : String(error).toLowerCase()

  return ENOSPC_PATTERNS.some((pattern) => msg.includes(pattern))
}
