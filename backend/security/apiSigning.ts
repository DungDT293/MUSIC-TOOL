/**
 * API Request Signing
 * Mỗi request kèm theo timestamp, nonce, và HMAC signature để chống replay attack và tampering
 */

import crypto from 'node:crypto'
import { getMachineHash } from '../license/machineId'
import {
  reportSignatureInvalid,
  reportSignatureReplay,
  reportNonceReused,
} from './securityMonitoring'

// Cache để track nonces đã dùng (chống replay)
const usedNonces: Map<string, number> = new Map()
const NONCE_CACHE_TTL_MS = 10 * 60 * 1000 // 10 phút

const SIGNATURE_ALGORITHM = 'sha256'
const NONCE_LENGTH = 16
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000 // 5 phút

/**
 * Generate nonce (random string)
 */
function generateNonce(): string {
  return crypto.randomBytes(NONCE_LENGTH).toString('hex')
}

/**
 * Derive signing key từ machineId
 */
async function deriveSigningKey(machineId: string): Promise<Buffer> {
  const salt = Buffer.from('93MediaToolMixNhac2025APISigningSalt!', 'utf8')
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(machineId, salt, 10000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/**
 * Create signature string từ payload
 * Format: timestamp|nonce|method|path|body
 */
function createSignatureString(
  timestamp: number,
  nonce: string,
  method: string,
  path: string,
  body: string
): string {
  return `${timestamp}|${nonce}|${method}|${path}|${body}`
}

/**
 * Calculate HMAC signature
 */
async function calculateSignature(
  signatureString: string,
  key: Buffer
): Promise<string> {
  return crypto.createHmac(SIGNATURE_ALGORITHM, key).update(signatureString).digest('hex')
}

/**
 * Sign request
 * Returns: { timestamp, nonce, signature }
 */
export async function signRequest(
  method: string,
  path: string,
  body: any
): Promise<{
  timestamp: number
  nonce: string
  signature: string
}> {
  const timestamp = Date.now()
  const nonce = generateNonce()
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body)

  const machineId = await getMachineHash()
  const signingKey = await deriveSigningKey(machineId)

  const signatureString = createSignatureString(timestamp, nonce, method, path, bodyString)
  const signature = await calculateSignature(signatureString, signingKey)

  return {
    timestamp,
    nonce,
    signature,
  }
}

/**
 * Verify request signature
 * (Dùng cho server-side, nhưng có thể test client-side)
 */
export async function verifyRequest(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  nonce: string,
  signature: string
): Promise<boolean> {
  try {
    // Check timestamp (chống replay attack)
    const now = Date.now()
    const age = Math.abs(now - timestamp)
    if (age > TIMESTAMP_TOLERANCE_MS) {
      console.warn(`[APISigning] Request timestamp too old/new: ${age}ms`)
      // Report replay attack
      await reportSignatureReplay({
        path,
        method,
        timestamp,
        age,
      })
      return false
    }

    // Check nonce reuse (chống replay attack)
    const nonceKey = `${timestamp}:${nonce}`
    if (usedNonces.has(nonceKey)) {
      console.warn(`[APISigning] Nonce reused: ${nonce}`)
      // Report nonce reuse
      await reportNonceReused({
        path,
        method,
        nonce,
      })
      return false
    }

    // Mark nonce as used
    usedNonces.set(nonceKey, now)
    // Cleanup old nonces
    for (const [key, time] of usedNonces.entries()) {
      if (now - time > NONCE_CACHE_TTL_MS) {
        usedNonces.delete(key)
      }
    }

    // Verify signature
    const machineId = await getMachineHash()
    const signingKey = await deriveSigningKey(machineId)

    const signatureString = createSignatureString(timestamp, nonce, method, path, body)
    const expectedSignature = await calculateSignature(signatureString, signingKey)

    // FIX H7 & M22: Pre-validate lengths before timingSafeEqual.
    // crypto.timingSafeEqual throws RangeError on length mismatch, which:
    //  - H7: Skips security monitoring (caught by generic catch, returns false silently)
    //  - M22: Leaks the length difference in the error message
    // By checking length first with strict equality (constant-time for this comparison
    // since HMAC-SHA256 hex is always 64 chars — length mismatch means invalid input format),
    // we log the attempt and return false cleanly.
    const sigBuf = Buffer.from(signature, 'utf8')
    const expectedBuf = Buffer.from(expectedSignature, 'utf8')

    if (sigBuf.length !== expectedBuf.length) {
      // Log the invalid attempt — format mismatch is suspicious
      await reportSignatureInvalid({
        path,
        method,
        expectedSignature: '(length mismatch)',
        receivedSignature: `(${sigBuf.length} bytes vs expected ${expectedBuf.length})`,
      })
      return false
    }

    const isValid = crypto.timingSafeEqual(sigBuf, expectedBuf)

    if (!isValid) {
      // Report invalid signature
      await reportSignatureInvalid({
        path,
        method,
        expectedSignature,
        receivedSignature: signature,
      })
    }

    return isValid
  } catch (error) {
    // FIX H7: Always log verification failures — even unexpected errors could be attacks
    console.warn('[APISigning] Signature verification failed:', error)
    try {
      await reportSignatureInvalid({
        path: path ?? 'unknown',
        method: method ?? 'unknown',
        expectedSignature: '(verification threw)',
        receivedSignature: signature ?? '(null)',
      })
    } catch (_) {} // Don't let monitoring failure mask the original error
    return false
  }
}

/**
 * Create signed headers cho request
 */
export async function createSignedHeaders(
  method: string,
  path: string,
  body: any
): Promise<Record<string, string>> {
  const signed = await signRequest(method, path, body)

  return {
    'x-timestamp': signed.timestamp.toString(),
    'x-nonce': signed.nonce,
    'x-signature': signed.signature,
    'x-machine-id': await getMachineHash(), // MachineId để server verify
  }
}

