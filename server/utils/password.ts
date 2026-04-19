/**
 * Password Hashing (using Web Crypto API - compatible with Cloudflare Workers)
 */

/**
 * Hash password using PBKDF2 (Web Crypto API)
 * Compatible with Cloudflare Workers (no native modules)
 */
export async function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  // Generate salt if not provided
  let saltBytes: Uint8Array
  if (!salt) {
    saltBytes = crypto.getRandomValues(new Uint8Array(16))
  } else {
    saltBytes = salt
  }

  // Import password as key material
  const encoder = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  // Derive key using PBKDF2
  // Create a new ArrayBuffer from Uint8Array to ensure type compatibility
  const saltBuffer = new ArrayBuffer(saltBytes.length)
  new Uint8Array(saltBuffer).set(saltBytes)

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000, // 100k iterations (strong)
      hash: 'SHA-256',
    },
    passwordKey,
    256 // 256 bits = 32 bytes
  )

  // Convert to base64 strings for storage
  const hash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
  const saltStr = btoa(String.fromCharCode(...saltBytes))

  return { hash, salt: saltStr }
}

/**
 * Verify password against stored hash
 */
export async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  try {
    // Decode salt from base64
    const saltBytes = new Uint8Array(
      atob(storedSalt)
        .split('')
        .map(c => c.charCodeAt(0))
    )

    // Hash the provided password with the stored salt
    const { hash } = await hashPassword(password, saltBytes)

    // Compare hashes (constant-time comparison)
    if (hash.length !== storedHash.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < hash.length; i++) {
      result |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i)
    }

    return result === 0
  } catch (err) {
    console.error('[verifyPassword] Error:', err)
    return false
  }
}

/**
 * Check if a password string is already hashed
 * Hashed passwords are stored as "hash:salt" format
 */
export function isPasswordHashed(password: string): boolean {
  // Hashed passwords are stored as "hash:salt" format
  // hash = base64 of 32 bytes (PBKDF2-SHA256) = 44 chars
  // salt = base64 of 16 bytes = 24 chars
  // Total = 44 + 1 + 24 = 69 chars
  if (!password || password.length !== 69) return false

  const parts = password.split(':')
  if (parts.length !== 2) return false
  if (parts[0].length !== 44 || parts[1].length !== 24) return false

  // Verify both parts are valid base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/
  return base64Regex.test(parts[0]) && base64Regex.test(parts[1])
}
