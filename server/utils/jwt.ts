/**
 * JWT Token Utilities for Auth Flow V2
 * 
 * Simple JWT implementation using Web Crypto API (compatible with Cloudflare Workers)
 * Format: header.payload.signature (base64url encoded)
 */

interface JWTHeader {
  alg: 'HS256'
  typ: 'JWT'
}

interface JWTPayload {
  sub: string // username
  machine_id: string
  key_id?: string // key_kich_hoat id (optional)
  iat: number // issued at
  exp: number // expires at
  type: 'device' | 'refresh'
}

/**
 * Base64URL encode (URL-safe base64)
 */
function base64UrlEncode(data: string): string {
  return btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Base64URL decode
 */
function base64UrlDecode(data: string): string {
  // Add padding if needed
  let padded = data
  while (padded.length % 4) {
    padded += '='
  }
  
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

/**
 * Get JWT secret from environment
 */
function getJWTSecret(env: { JWT_SECRET?: string }): string {
  if (env.JWT_SECRET) {
    return env.JWT_SECRET
  }
  
  // Fallback to a default (should be set in production)
  const defaultSecret = 'CHANGE_ME_IN_PRODUCTION_JWT_SECRET'
  if (defaultSecret === 'CHANGE_ME_IN_PRODUCTION_JWT_SECRET') {
    console.warn('[JWT] JWT_SECRET not set, using weak default. Set JWT_SECRET environment variable for production.')
  }
  
  return defaultSecret
}

/**
 * Create HMAC-SHA256 signature
 */
async function createSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(data)
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * Verify HMAC-SHA256 signature
 */
async function verifySignature(data: string, signature: string, secret: string): Promise<boolean> {
  const expectedSignature = await createSignature(data, secret)
  return signature === expectedSignature
}

/**
 * Generate JWT token
 */
export async function generateToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  expiresInSeconds: number,
  env: { JWT_SECRET?: string }
): Promise<string> {
  const secret = getJWTSecret(env)
  const now = Math.floor(Date.now() / 1000)
  
  const header: JWTHeader = {
    alg: 'HS256',
    typ: 'JWT',
  }
  
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  }
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload))
  const data = `${encodedHeader}.${encodedPayload}`
  
  const signature = await createSignature(data, secret)
  
  return `${data}.${signature}`
}

/**
 * Verify and decode JWT token
 */
export async function verifyToken(
  token: string,
  env: { JWT_SECRET?: string }
): Promise<{ valid: boolean; payload?: JWTPayload; error?: string }> {
  try {
    const secret = getJWTSecret(env)
    const parts = token.split('.')
    
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' }
    }
    
    const [encodedHeader, encodedPayload, signature] = parts
    
    // Verify signature
    const data = `${encodedHeader}.${encodedPayload}`
    const isValid = await verifySignature(data, signature, secret)
    
    if (!isValid) {
      return { valid: false, error: 'Invalid signature' }
    }
    
    // Decode payload
    const payloadJson = base64UrlDecode(encodedPayload)
    const payload: JWTPayload = JSON.parse(payloadJson)
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      return { valid: false, error: 'Token expired' }
    }
    
    return { valid: true, payload }
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Token verification failed' }
  }
}

/**
 * Generate refresh token (simple UUID)
 */
export function generateRefreshToken(): string {
  // Use crypto.randomUUID() if available, otherwise generate random string
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  
  // Fallback: generate random string
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
