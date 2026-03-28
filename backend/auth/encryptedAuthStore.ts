/**
 * Encrypted Auth Store - Mã hóa auth state để bảo mật
 * Sử dụng AES-256-GCM với key derivation từ machineId
 * Kèm HMAC-SHA256 để integrity check
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getMachineHash } from '../license/machineId'
import type { StoredAuthState } from './authStore'
import type { SessionInfo } from './sessionManager'
import { reportEncryptionFailed, reportMachineIdMismatch } from '../security/securityMonitoring'

const AUTH_FILE_NAME = 'authState.enc'
const SALT_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16
const HMAC_LENGTH = 32
const PBKDF2_ITERATIONS = 10000
const KEY_LENGTH = 32 // 256 bits

// Salt cố định được embed trong code (không lưu trong file)
// Nếu muốn tăng bảo mật, có thể random mỗi lần và lưu riêng
const EMBEDDED_SALT = Buffer.from('93MediaToolMixNhac2025SecuritySalt!', 'utf8')

function resolveStoragePath(): string {
  if (process.env.AUTH_STATE_PATH) {
    return process.env.AUTH_STATE_PATH.replace(/\.json$/, '.enc')
  }
  const commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData')
  const dir = path.join(commonAppData, '93MediaToolMixNhac')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, AUTH_FILE_NAME)
}

/**
 * Derive encryption key từ machineId
 */
async function deriveKey(machineId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(machineId, EMBEDDED_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/**
 * Derive HMAC key từ machineId (key khác với encryption key)
 */
async function deriveHMACKey(machineId: string): Promise<Buffer> {
  // Dùng salt khác cho HMAC
  const hmacSalt = Buffer.from('93MediaToolMixNhac2025HMACSalt!', 'utf8')
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(machineId, hmacSalt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/**
 * Tính HMAC-SHA256 của data
 */
async function calculateHMAC(data: Buffer, key: Buffer): Promise<Buffer> {
  return crypto.createHmac('sha256', key).update(data).digest()
}

/**
 * Verify HMAC
 */
async function verifyHMAC(data: Buffer, hmac: Buffer, key: Buffer): Promise<boolean> {
  const calculated = await calculateHMAC(data, key)
  return crypto.timingSafeEqual(calculated, hmac)
}

/**
 * Mã hóa auth state
 */
async function encryptAuthState(state: StoredAuthState, machineId: string): Promise<string> {
  // Convert state to JSON
  const plaintext = JSON.stringify(state)
  const plaintextBuffer = Buffer.from(plaintext, 'utf8')

  // Derive keys
  const encryptionKey = await deriveKey(machineId)
  const hmacKey = await deriveHMACKey(machineId)

  // Generate IV (Initialization Vector)
  const iv = crypto.randomBytes(IV_LENGTH)

  // Encrypt với AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Combine: IV + Encrypted + AuthTag
  const encryptedData = Buffer.concat([iv, encrypted, authTag])

  // Calculate HMAC của encrypted data
  const hmac = await calculateHMAC(encryptedData, hmacKey)

  // Final format: HMAC + IV + Encrypted + AuthTag
  const final = Buffer.concat([hmac, encryptedData])

  // Return base64 encoded
  return final.toString('base64')
}

/**
 * Giải mã auth state
 */
async function decryptAuthState(encryptedBase64: string, machineId: string): Promise<StoredAuthState | null> {
  try {
    const final = Buffer.from(encryptedBase64, 'base64')

    // Extract components
    if (final.length < HMAC_LENGTH + IV_LENGTH + TAG_LENGTH) {
      console.warn('[encryptedAuthStore] Invalid encrypted data length')
      return null
    }

    const hmac = final.subarray(0, HMAC_LENGTH)
    const encryptedData = final.subarray(HMAC_LENGTH)
    const iv = encryptedData.subarray(0, IV_LENGTH)
    const encrypted = encryptedData.subarray(IV_LENGTH, encryptedData.length - TAG_LENGTH)
    const authTag = encryptedData.subarray(encryptedData.length - TAG_LENGTH)

    // Derive keys
    const encryptionKey = await deriveKey(machineId)
    const hmacKey = await deriveHMACKey(machineId)

    // Verify HMAC trước khi decrypt
    const isValidHMAC = await verifyHMAC(encryptedData, hmac, hmacKey)
    if (!isValidHMAC) {
      console.warn('[encryptedAuthStore] HMAC verification failed - data may be tampered')
      // Report tampering attempt
      await reportEncryptionFailed({
        operation: 'decrypt',
        error: 'HMAC verification failed - possible tampering',
      })
      return null
    }

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    // Parse JSON
    const state = JSON.parse(decrypted.toString('utf8')) as StoredAuthState
    return state
  } catch (error: any) {
    console.warn('[encryptedAuthStore] Decryption failed:', error.message)
    return null
  }
}

/**
 * Đọc encrypted auth state từ file
 */
export async function readEncryptedAuthState(): Promise<StoredAuthState | null> {
  try {
    const file = resolveStoragePath()
    if (!fs.existsSync(file)) {
      return null
    }

    const encryptedBase64 = fs.readFileSync(file, 'utf8').trim()
    if (!encryptedBase64) {
      return null
    }

    // Lấy machineId hiện tại
    const currentMachineId = await getMachineHash()

    // Decrypt
    const state = await decryptAuthState(encryptedBase64, currentMachineId)
    if (!state) {
      console.warn('[encryptedAuthStore] Failed to decrypt auth state')
      return null
    }

    // Check session validity
    if (state && state.status === 'allowed' && state.sessionInfo) {
      const { isSessionValid } = await import('./sessionManager')
      if (!isSessionValid(state.sessionInfo as SessionInfo)) {
        console.warn('[encryptedAuthStore] Session expired, clearing auth state')
        await clearEncryptedAuthState()
        return null
      }
    }

    // QUAN TRỌNG: Verify machineId trong decrypted state khớp với current
    // Nếu không khớp, có thể user đã sửa file hoặc chuyển sang máy khác
    if (state.machineId !== currentMachineId) {
      console.warn(
        '[encryptedAuthStore] MachineId mismatch! Stored:',
        state.machineId.substring(0, 16),
        '... Current:',
        currentMachineId.substring(0, 16),
        '...'
      )
      console.warn('[encryptedAuthStore] This may indicate tampering or machine change')
      // Report machine ID mismatch
      await reportMachineIdMismatch({
        storedMachineId: state.machineId,
        currentMachineId,
        context: 'encryptedAuthStore.read',
      })
      return null
    }

    return state
  } catch (error: any) {
    console.warn('[encryptedAuthStore] Failed to read encrypted auth state:', error.message)
    return null
  }
}

/**
 * Ghi encrypted auth state vào file
 */
export async function writeEncryptedAuthState(state: StoredAuthState): Promise<void> {
  try {
    // Đảm bảo machineId trong state khớp với current
    const currentMachineId = await getMachineHash()
    if (state.machineId !== currentMachineId) {
      console.warn('[encryptedAuthStore] MachineId mismatch when writing - using current machineId')
      state.machineId = currentMachineId
    }

    // Encrypt
    const encryptedBase64 = await encryptAuthState(state, currentMachineId)

    // Write to file
    const file = resolveStoragePath()
    fs.writeFileSync(file, encryptedBase64, 'utf8')
  } catch (error: any) {
    console.error('[encryptedAuthStore] Failed to write encrypted auth state:', error.message)
    throw error
  }
}

/**
 * Xóa encrypted auth state file
 */
export function clearEncryptedAuthState(): void {
  try {
    const file = resolveStoragePath()
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
  } catch (error: any) {
    console.error('[encryptedAuthStore] Failed to clear encrypted auth state:', error.message)
  }
}

/**
 * Migrate từ old plaintext format sang encrypted format
 * (Chỉ chạy một lần khi upgrade)
 */
export async function migrateFromPlaintext(): Promise<boolean> {
  try {
    // Check old file
    const oldFile = resolveStoragePath().replace(/\.enc$/, '.json')
    if (!fs.existsSync(oldFile)) {
      return false // Không có file cũ
    }

    // Read old format
    const oldData = fs.readFileSync(oldFile, 'utf8')
    const oldState = JSON.parse(oldData) as StoredAuthState

    // Write new encrypted format
    await writeEncryptedAuthState(oldState)

    // Backup old file (đổi tên thay vì xóa)
    const backupFile = oldFile + '.backup'
    fs.renameSync(oldFile, backupFile)

    console.log('[encryptedAuthStore] Migrated from plaintext to encrypted format')
    return true
  } catch (error: any) {
    console.warn('[encryptedAuthStore] Migration failed:', error.message)
    return false
  }
}

