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
import { reportEncryptionFailed } from '../security/securityMonitoring'

const AUTH_FILE_NAME = 'authState.enc'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const HMAC_LENGTH = 32
const SALT_LENGTH = 32 // FIX H4: Random per-file salt
const PBKDF2_ITERATIONS = 300000
const KEY_LENGTH = 32 // 256 bits
const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL

// FIX H4: Legacy hardcoded salt — used ONLY for reading old v1 files during migration.
// New files always use a random salt stored in the encrypted blob header.
const LEGACY_EMBEDDED_SALT = Buffer.from('93MediaToolMixNhac2025SecuritySalt!', 'utf8')
const LEGACY_HMAC_SALT = Buffer.from('93MediaToolMixNhac2025HMACSalt!', 'utf8')

// Magic bytes to identify v2 format (random salt) vs v1 format (hardcoded salt)
const V2_MAGIC = Buffer.from([0x93, 0x4D, 0x54, 0x02]) // "93MT" + version 2

function getPreferredStoragePath(): string {
  const appData = process.env.APPDATA || path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming')
  return path.join(appData, '93MediaToolMixNhac', AUTH_FILE_NAME)
}

function getLegacyStoragePaths(): string[] {
  const appData = process.env.APPDATA || path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local')
  const commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData')
  return [
    path.join(commonAppData, '93MediaToolMixNhac', AUTH_FILE_NAME),
    path.join(appData, '93-media-tool-mix-nhac', AUTH_FILE_NAME),
    path.join(localAppData, '93MediaToolMixNhac', AUTH_FILE_NAME),
  ]
}

function getStorageCandidates(): string[] {
  const primary = resolveStoragePath()
  return Array.from(new Set([primary, ...getLegacyStoragePaths()]))
}

export function hasAuthStorageFootprint(): boolean {
  try {
    return getStorageCandidates().some((file) => fs.existsSync(file))
  } catch {
    return false
  }
}

export function resolveStoragePath(): string {
  // Security: only allow env var override in development
  if (isDev && process.env.AUTH_STATE_PATH) {
    return process.env.AUTH_STATE_PATH.replace(/\.json$/, '.enc')
  }
  const file = getPreferredStoragePath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return file
}

/**
 * Derive encryption key từ machineId
 * FIX H4: Salt is now a parameter — callers pass either random (v2) or legacy (v1) salt
 */
async function deriveKey(machineId: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(machineId, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/**
 * Derive HMAC key từ machineId (key khác với encryption key)
 * FIX H4: Derives a separate HMAC key by appending 'hmac' domain separator to salt
 */
async function deriveHMACKey(machineId: string, salt: Buffer): Promise<Buffer> {
  // Domain-separate HMAC key from encryption key using salt + 'hmac' suffix
  const hmacSalt = Buffer.concat([salt, Buffer.from(':hmac', 'utf8')])
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
 * FIX H4: v2 format — generates a random salt per-write, stored in the blob header.
 * Layout: V2_MAGIC(4) + SALT(32) + HMAC(32) + IV(16) + ENCRYPTED(...) + AUTH_TAG(16)
 */
async function encryptAuthState(state: StoredAuthState, machineId: string): Promise<string> {
  // Convert state to JSON
  const plaintext = JSON.stringify(state)
  const plaintextBuffer = Buffer.from(plaintext, 'utf8')

  // FIX H4: Generate a random salt for this write operation
  const salt = crypto.randomBytes(SALT_LENGTH)

  // Derive keys with per-file random salt
  const encryptionKey = await deriveKey(machineId, salt)
  const hmacKey = await deriveHMACKey(machineId, salt)

  // Generate IV (Initialization Vector)
  const iv = crypto.randomBytes(IV_LENGTH)

  // Encrypt với AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Combine: IV + Encrypted + AuthTag
  const encryptedData = Buffer.concat([iv, encrypted, authTag])

  // Calculate HMAC của encrypted data (covers IV + ciphertext + tag)
  const hmac = await calculateHMAC(encryptedData, hmacKey)

  // FIX H4: v2 final format: MAGIC + SALT + HMAC + IV + Encrypted + AuthTag
  const final = Buffer.concat([V2_MAGIC, salt, hmac, encryptedData])

  // Return base64 encoded
  return final.toString('base64')
}

/**
 * Giải mã auth state
 * FIX H4: Supports both v2 (random salt) and v1 (legacy hardcoded salt) formats.
 * v1 files are transparently upgraded to v2 on next write.
 */
async function decryptAuthState(encryptedBase64: string, machineId: string): Promise<StoredAuthState | null> {
  try {
    const final = Buffer.from(encryptedBase64, 'base64')

    // FIX H4: Detect format by checking v2 magic bytes
    const isV2 = final.length >= V2_MAGIC.length &&
      final[0] === V2_MAGIC[0] && final[1] === V2_MAGIC[1] &&
      final[2] === V2_MAGIC[2] && final[3] === V2_MAGIC[3]

    let salt: Buffer
    let hmac: Buffer
    let encryptedData: Buffer

    if (isV2) {
      // v2 layout: MAGIC(4) + SALT(32) + HMAC(32) + IV(16) + ENCRYPTED(...) + AUTH_TAG(16)
      const minV2Length = V2_MAGIC.length + SALT_LENGTH + HMAC_LENGTH + IV_LENGTH + TAG_LENGTH
      if (final.length < minV2Length) {
        console.warn('[encryptedAuthStore] Invalid v2 encrypted data length')
        return null
      }
      let offset = V2_MAGIC.length
      salt = final.subarray(offset, offset + SALT_LENGTH); offset += SALT_LENGTH
      hmac = final.subarray(offset, offset + HMAC_LENGTH); offset += HMAC_LENGTH
      encryptedData = final.subarray(offset) // IV + encrypted + authTag
    } else {
      // v1 legacy layout: HMAC(32) + IV(16) + ENCRYPTED(...) + AUTH_TAG(16)
      if (final.length < HMAC_LENGTH + IV_LENGTH + TAG_LENGTH) {
        console.warn('[encryptedAuthStore] Invalid v1 encrypted data length')
        return null
      }
      salt = LEGACY_EMBEDDED_SALT
      hmac = final.subarray(0, HMAC_LENGTH)
      encryptedData = final.subarray(HMAC_LENGTH)
    }

    const iv = encryptedData.subarray(0, IV_LENGTH)
    const encrypted = encryptedData.subarray(IV_LENGTH, encryptedData.length - TAG_LENGTH)
    const authTag = encryptedData.subarray(encryptedData.length - TAG_LENGTH)

    // Derive keys (using detected salt — random for v2, legacy constant for v1)
    const encryptionKey = await deriveKey(machineId, salt)
    const hmacKey = isV2
      ? await deriveHMACKey(machineId, salt)
      : await deriveLegacyHMACKey(machineId)

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

    if (!isV2) {
      console.log('[encryptedAuthStore] Read v1 (legacy salt) file — will upgrade to v2 on next write')
    }

    return state
  } catch (error: any) {
    console.warn('[encryptedAuthStore] Decryption failed:', error.message)
    return null
  }
}

/**
 * Legacy HMAC key derivation (v1 format only) — uses hardcoded HMAC salt.
 * Kept only for backward-compatible reads during migration.
 */
async function deriveLegacyHMACKey(machineId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(machineId, LEGACY_HMAC_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/**
 * Kiểm tra file .enc có tồn tại không (không cần decrypt).
 * Dùng để phân biệt "chưa đăng ký lần nào" vs "machineId thay đổi cần đăng nhập lại".
 */
export function hasEncryptedAuthFile(): boolean {
  try {
    return getStorageCandidates().some((file) => fs.existsSync(file))
  } catch {
    return false
  }
}

/**
 * Đọc encrypted auth state từ file
 */
export async function readEncryptedAuthState(): Promise<StoredAuthState | null> {
  try {
    // Lấy machineId hiện tại
    const currentMachineId = await getMachineHash()

    for (const file of getStorageCandidates()) {
      if (!fs.existsSync(file)) {
        continue
      }

      const encryptedBase64 = fs.readFileSync(file, 'utf8').trim()
      if (!encryptedBase64) {
        continue
      }

      // Decrypt
      const state = await decryptAuthState(encryptedBase64, currentMachineId)
      if (!state) {
        // Decryption failed — có thể do machineId thay đổi (VPN, driver update, cache bị xóa)
        // KHÔNG xóa file — giữ lại để user có thể đăng nhập lại bằng username/password.
        // Chỉ thử path tiếp theo; nếu không có path nào đọc được thì trả về null ở cuối.
        console.warn('[encryptedAuthStore] Failed to decrypt auth state from', file, '— machineId may have changed. File kept for recovery.')
        continue
      }

      // Check session validity
      if (state.status === 'allowed' && state.sessionInfo) {
        const { isSessionValid } = await import('./sessionManager')
        if (!isSessionValid(state.sessionInfo as SessionInfo)) {
          console.warn('[encryptedAuthStore] Session expired, clearing auth state')
          await clearEncryptedAuthState()
          return null
        }
      }

      // QUAN TRỌNG: Verify machineId trong decrypted state khớp với current
      // Nếu không khớp: có thể do cache machine-id.txt bị xóa và hash được tính lại khác.
      // Trường hợp này KHÔNG phải tampering — là side effect của VPN/cleanup tools.
      // → Trả về null (app sẽ yêu cầu đăng nhập lại) nhưng KHÔNG xóa file.
      if (state.machineId !== currentMachineId) {
        console.warn(
          '[encryptedAuthStore] MachineId mismatch — stored:',
          state.machineId.substring(0, 16) + '...',
          'current:',
          currentMachineId.substring(0, 16) + '...'
        )
        console.warn('[encryptedAuthStore] Likely caused by: VPN adapter change, cleanup tool deleted cache, or Windows 11 wmic deprecated fallback.')
        console.warn('[encryptedAuthStore] Keeping .enc file — user can re-login with username/password.')
        continue
      }

      const primary = resolveStoragePath()
      if (file !== primary) {
        try {
          await writeEncryptedAuthState(state)
          console.log('[encryptedAuthStore] Migrated auth state to primary storage:', primary)
        } catch (error: any) {
          console.warn('[encryptedAuthStore] Failed to migrate auth state to primary storage:', error.message)
        }
      }

      return state
    }
    return null
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
    const files = new Set<string>()
    for (const file of getStorageCandidates()) {
      files.add(file)
      files.add(file.replace(/\.enc$/, '.json'))
      files.add(file.replace(/\.enc$/, '.json.backup'))
    }
    for (const file of files) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
      }
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
    for (const oldFile of getStorageCandidates().map((file) => file.replace(/\.enc$/, '.json'))) {
      if (!fs.existsSync(oldFile)) {
        continue
      }

      // Read old format
      const oldData = fs.readFileSync(oldFile, 'utf8')
      const oldState = JSON.parse(oldData) as StoredAuthState

      // Write new encrypted format
      await writeEncryptedAuthState(oldState)

      // Security fix #17: delete backup file after successful migration — plaintext backup
      // must not persist on disk as it contains credentials in plain JSON.
      const backupFile = oldFile + '.backup'
      fs.renameSync(oldFile, backupFile)
      try { fs.unlinkSync(backupFile) } catch (_) {}

      console.log('[encryptedAuthStore] Migrated from plaintext to encrypted format')
      return true
    }
    return false
  } catch (error: any) {
    console.warn('[encryptedAuthStore] Migration failed:', error.message)
    return false
  }
}
