/// <reference path="./types.d.ts" />

/**
 * Server-Side Signature Verification
 * Verify requests từ client có signature hợp lệ
 */

interface Env {
  DB?: D1Database
}

interface VerificationResult {
  valid: boolean
  error?: string
}

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000 // 5 phút
const NONCE_EXPIRY_MS = 10 * 60 * 1000 // 10 phút

/**
 * Derive signing key từ machineId (giống client)
 * Sử dụng Web Crypto API cho Cloudflare Workers
 */
async function deriveSigningKey(machineId: string): Promise<Uint8Array> {
  // Sử dụng cùng salt và iterations như client
  const salt = new TextEncoder().encode('93MediaToolMixNhac2025APISigningSalt!')
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(machineId),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes = 256 bits
  )
  
  return new Uint8Array(derivedBits)
}

/**
 * Calculate HMAC signature
 * Sử dụng Web Crypto API
 */
async function calculateHMAC(data: string, key: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(data)
  )
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(signature))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  
  // Use constant-time comparison
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Verify request signature
 */
export async function verifyRequestSignature(
  request: Request,
  body: any,
  env: Env
): Promise<VerificationResult> {
  try {
    // 1. Extract headers
    const timestamp = request.headers.get('x-timestamp')
    const nonce = request.headers.get('x-nonce')
    const signature = request.headers.get('x-signature')
    const machineId = request.headers.get('x-machine-id')

    // 2. Validate headers exist
    if (!timestamp || !nonce || !signature || !machineId) {
      return { valid: false, error: 'Missing signature headers' }
    }

    // 3. Check timestamp (chống replay)
    const now = Date.now()
    const timestampNum = parseInt(timestamp, 10)
    if (isNaN(timestampNum)) {
      return { valid: false, error: 'Invalid timestamp format' }
    }
    
    const age = Math.abs(now - timestampNum)
    if (age > TIMESTAMP_TOLERANCE_MS) {
      return { valid: false, error: `Request timestamp too old/new: ${age}ms` }
    }

    // 4. Check nonce reuse (chống replay) - chỉ nếu có DB
    if (env.DB) {
      const nonceKey = `${machineId}:${nonce}:${timestampNum}`
      const usedNonce = await env.DB.prepare(
        'SELECT 1 FROM used_nonces WHERE nonce_key = ? AND expires_at > ?'
      )
        .bind(nonceKey, now)
        .first()

      if (usedNonce) {
        return { valid: false, error: 'Nonce already used (replay attack)' }
      }
    }

    // 5. Verify signature
    const url = new URL(request.url)
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body)
    const signatureString = `${timestampNum}|${nonce}|${request.method}|${url.pathname}|${bodyString}`
    
    // Derive key từ machineId (giống client)
    const signingKey = await deriveSigningKey(machineId)
    const expectedSignature = await calculateHMAC(signatureString, signingKey)

    if (!timingSafeEqual(signature, expectedSignature)) {
      return { valid: false, error: 'Invalid signature' }
    }

    // 6. Mark nonce as used (chỉ nếu có DB)
    if (env.DB) {
      const nonceKey = `${machineId}:${nonce}:${timestampNum}`
      await env.DB.prepare(
        'INSERT INTO used_nonces (nonce_key, machine_id, expires_at) VALUES (?, ?, ?)'
      )
        .bind(nonceKey, machineId, now + NONCE_EXPIRY_MS)
        .run()
    }

    return { valid: true }
  } catch (error: any) {
    return { valid: false, error: error.message || 'Verification failed' }
  }
}

/**
 * Cleanup old nonces (chạy định kỳ)
 */
export async function cleanupOldNonces(env: Env): Promise<void> {
  if (!env.DB) {
    return
  }

  try {
    const now = Date.now()
    await env.DB.prepare('DELETE FROM used_nonces WHERE expires_at < ?').bind(now).run()
  } catch (error) {
    console.error('[Security Verification] Failed to cleanup old nonces:', error)
  }
}

