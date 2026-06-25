import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIGABYTE = 1024 * 1024 * 1024

export interface DiskSpaceInfo {
  drive: string
  total: number
  free: number
  /** true khi KHÔNG đo được dung lượng thật (mọi phương pháp đều fail).
   *  Caller PHẢI fail-open (không chặn) khi gặp cờ này — tránh chặn nhầm. */
  unknown?: boolean
}

export interface SpaceCheckResult {
  freeBytes: number
  requiredBytes: number
  enough: boolean
}

/**
 * Đo dung lượng ổ chứa `targetPath`.
 *
 * Thứ tự ưu tiên:
 *  1. fs.statfs — chính xác, cross-platform, không phụ thuộc WMIC (Node 18.15+/Electron 20+).
 *  2. POSIX `df -k` (chỉ non-win fallback).
 *
 * KHÔNG dùng os.freemem() làm fallback (đó là RAM, không phải disk — gây cảnh báo sai).
 * Nếu mọi cách fail → trả về { unknown: true } để caller fail-open thay vì chặn nhầm.
 */
export async function getDiskSpace(targetPath: string): Promise<DiskSpaceInfo> {
  let resolved: string
  try {
    resolved = path.resolve(targetPath || os.homedir())
  } catch {
    resolved = os.homedir()
  }

  const driveLabel =
    process.platform === 'win32'
      ? (resolved.startsWith('\\\\') ? resolved : resolved.slice(0, 2).toUpperCase())
      : resolved

  // ── Phương pháp 1: fs.statfs (chính xác nhất, không cần WMIC) ──
  // statfs có từ Node 18.15+. Electron 36 chạy Node 20 → luôn có.
  try {
    const statfs = (fs.promises as any).statfs as
      | ((p: string) => Promise<{ bsize: number; blocks: number; bavail: number; bfree: number }>)
      | undefined
    if (typeof statfs === 'function') {
      const st = await statfs(resolved)
      const blockSize = st.bsize
      const free = st.bavail * blockSize // bavail = block khả dụng cho user (chuẩn hơn bfree)
      const total = st.blocks * blockSize
      if (Number.isFinite(free) && Number.isFinite(total) && free >= 0 && total > 0) {
        return { drive: driveLabel, free, total }
      }
    }
  } catch (err) {
    console.warn('[diskSpace] fs.statfs failed, trying platform fallback:', err)
  }

  if (process.platform === 'win32') {
    // ── Fallback Windows: WMIC (có thể đã bị gỡ trên Win10 mới / Win11) ──
    const drive = /^[A-Z]:$/.test(driveLabel) ? driveLabel : 'C:'
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
      }
    } catch (err) {
      console.warn('[diskSpace] WMIC fallback failed:', err)
    }

    // Mọi cách fail → đánh dấu unknown (caller fail-open, KHÔNG chặn)
    console.warn(`[diskSpace] Không đo được dung lượng ổ ${drive}. Trả về unknown (fail-open).`)
    return { drive, free: Number.POSITIVE_INFINITY, total: 0, unknown: true }
  }

  // ── POSIX fallback: df -k ──
  try {
    const { stdout } = await execFileAsync('df', ['-k', resolved])
    const lines = stdout.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      const totalKb = Number(parts[1])
      const freeKb = Number(parts[3])
      if (Number.isFinite(totalKb) && Number.isFinite(freeKb)) {
        return { drive: resolved, total: totalKb * 1024, free: freeKb * 1024 }
      }
    }
  } catch (err) {
    console.warn('[diskSpace] df command failed:', err)
  }

  console.warn(`[diskSpace] Không đo được dung lượng ${resolved}. Trả về unknown (fail-open).`)
  return { drive: resolved, free: Number.POSITIVE_INFINITY, total: 0, unknown: true }
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
