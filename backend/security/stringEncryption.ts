/**
 * String Encryption Utility
 * Mã hóa các string nhạy cảm (API URLs, secrets, error messages)
 * để tránh reverse engineering
 */

import crypto from 'node:crypto'

// Key derivation từ một constant (có thể thay đổi)
const STRING_ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update('93MediaToolMixNhac2025StringEncryptionKey!@#')
  .digest()

const IV_LENGTH = 16

/**
 * Encrypt một string
 */
export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', STRING_ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return iv.toString('base64') + ':' + encrypted.toString('base64')
}

/**
 * Decrypt một string
 */
export function decryptString(encrypted: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted string format')
  }
  const iv = Buffer.from(parts[0], 'base64')
  const encryptedData = Buffer.from(parts[1], 'base64')
  const decipher = crypto.createDecipheriv('aes-256-cbc', STRING_ENCRYPTION_KEY, iv)
  return decipher.update(encryptedData, undefined, 'utf8') + decipher.final('utf8')
}

/**
 * Pre-encrypted strings (được encrypt tại build time)
 * Format: { key: encrypted_value }
 *
 * ⚠️ SECURITY NOTE: Đây là obfuscation, KHÔNG phải encryption thực sự.
 * Secrets thực (INSTALLER_KEY, INSTALLER_SECRET) PHẢI được inject qua
 * process.env tại CI/build time. Các giá trị dưới đây CHỈ là URL public
 * và fallback không nhạy cảm.
 *
 * Set trong CI/CD:
 *   LICENSE_INSTALLER_KEY=<secret>
 *   LICENSE_INSTALLER_SECRET=<secret>
 *   LICENSE_SERVER_BASE=<url>  (tuỳ chọn)
 */
const ENCRYPTED_STRINGS: Record<string, string> = {
  // API URLs (public, không nhạy cảm)
  AUTH_BASE: encryptString('https://license-server.dungdong333.workers.dev'),
  LICENSE_BASE: encryptString('https://license-server.dungdong333.workers.dev'),
}

/**
 * Get decrypted string by key
 */
export function getDecryptedString(key: keyof typeof ENCRYPTED_STRINGS): string {
  const encrypted = ENCRYPTED_STRINGS[key]
  if (!encrypted) {
    throw new Error(`Encrypted string not found: ${key}`)
  }
  return decryptString(encrypted)
}

/**
 * Runtime encryption (cho các string động)
 */
export class StringEncryptor {
  private static cache: Map<string, string> = new Map()

  static encrypt(plaintext: string): string {
    if (this.cache.has(plaintext)) {
      return this.cache.get(plaintext)!
    }
    const encrypted = encryptString(plaintext)
    this.cache.set(plaintext, encrypted)
    return encrypted
  }

  static decrypt(encrypted: string): string {
    return decryptString(encrypted)
  }
}
