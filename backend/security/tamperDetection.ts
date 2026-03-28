/**
 * Tamper Detection
 * Phát hiện khi code/executable bị sửa đổi
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { reportTamperingDetected, reportFileIntegrityFailed } from './securityMonitoring'

/**
 * Calculate file hash (SHA-256)
 */
export function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Get expected hash của main executable
 * Hash này sẽ được embed trong code tại build time
 */
function getExpectedMainHash(): string | null {
  // Trong production, hash này sẽ được embed từ build process
  // Tạm thời return null để skip check trong dev
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return null
  }

  // TODO: Embed hash từ build process
  // const EXPECTED_MAIN_HASH = '...'
  // return EXPECTED_MAIN_HASH
  return null
}

/**
 * Verify executable integrity
 */
export async function verifyExecutableIntegrity(): Promise<boolean> {
  try {
    const expectedHash = getExpectedMainHash()
    if (!expectedHash) {
      // Skip check trong dev hoặc nếu chưa có expected hash
      return true
    }

    // Get main executable path
    const exePath = process.execPath
    if (!fs.existsSync(exePath)) {
      return false
    }

    const actualHash = await calculateFileHash(exePath)
    const isValid = actualHash === expectedHash
    
    if (!isValid) {
      // Report tampering
      await reportFileIntegrityFailed({
        file: exePath,
        expectedHash,
        actualHash,
      })
    }
    
    return isValid
  } catch (error) {
    console.warn('[TamperDetection] Failed to verify executable integrity:', error)
    return true // Fail open trong trường hợp lỗi
  }
}

/**
 * Verify main.js integrity (Electron main process)
 */
export async function verifyMainJsIntegrity(): Promise<boolean> {
  try {
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
      return true // Skip trong dev
    }

    // Get main.js path
    const mainJsPath = path.join(__dirname, '../../dist-electron/main/main.js')
    if (!fs.existsSync(mainJsPath)) {
      return true // File không tồn tại trong dev mode
    }

    // Calculate hash
    const hash = await calculateFileHash(mainJsPath)

    // TODO: Compare với expected hash (embed từ build)
    // const EXPECTED_MAIN_JS_HASH = '...'
    // return hash === EXPECTED_MAIN_JS_HASH

    // Tạm thời return true
    return true
  } catch (error) {
    console.warn('[TamperDetection] Failed to verify main.js integrity:', error)
    return true
  }
}

/**
 * Detect function hooking (basic check)
 * Chỉ chạy trong renderer process
 */
export function detectFunctionHooking(): boolean {
  try {
    if (typeof window === 'undefined') {
      return false // Node.js environment - skip
    }

    // Check nếu các hàm quan trọng bị override
    const originalFetch = window.fetch
    if (originalFetch.toString().includes('native code')) {
      // Function chưa bị hook
      return false
    }

    // Có thể bị hook
    return true
  } catch {
    return false
  }
}

/**
 * Self-checksum verification (verify chính nó)
 */
export async function verifySelfChecksum(): Promise<boolean> {
  try {
    if (process.env.NODE_ENV === 'development') {
      return true // Skip trong dev
    }

    // Get current file path (tamperDetection.ts compiled)
    const currentFile = __filename
    if (!fs.existsSync(currentFile)) {
      return true
    }

    // Calculate hash
    const hash = await calculateFileHash(currentFile)

    // TODO: Compare với expected hash
    // const EXPECTED_SELF_HASH = '...'
    // return hash === EXPECTED_SELF_HASH

    return true
  } catch (error) {
    console.warn('[TamperDetection] Failed to verify self checksum:', error)
    return true
  }
}

/**
 * Main tamper detection check
 */
export async function checkTampering(): Promise<{
  isTampered: boolean
  reasons: string[]
}> {
  const reasons: string[] = []

  // Check executable integrity
  const exeOk = await verifyExecutableIntegrity()
  if (!exeOk) {
    reasons.push('Executable integrity check failed')
  }

  // Check main.js integrity
  const mainJsOk = await verifyMainJsIntegrity()
  if (!mainJsOk) {
    reasons.push('Main.js integrity check failed')
  }

  // Check function hooking (chỉ trong renderer)
  if (typeof window !== 'undefined') {
    const hookOk = !detectFunctionHooking()
    if (!hookOk) {
      reasons.push('Function hooking detected')
    }
  }

  return {
    isTampered: reasons.length > 0,
    reasons,
  }
}

/**
 * Initialize tamper detection
 */
export function initTamperDetection(): void {
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return // Skip trong dev
  }

  // Periodic check (mỗi 5 phút)
  setInterval(async () => {
    const result = await checkTampering()
    if (result.isTampered) {
      console.error('[TamperDetection] Tampering detected:', result.reasons)
      // Report tampering
      await reportTamperingDetected({
        reasons: result.reasons,
      })
      // Có thể thực hiện action: log, alert, exit, etc.
    }
  }, 5 * 60 * 1000)
}

