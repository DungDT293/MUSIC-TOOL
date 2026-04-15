/**
 * Rate Limiter
 * Giới hạn số lần thử trong một khoảng thời gian
 */

export interface RateLimitConfig {
  maxAttempts: number
  windowMs: number
  cooldownMs?: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining?: number
  resetAt?: number
}

interface HeadersLike {
  get(name: string): string | null
}

interface RequestLike {
  headers: HeadersLike
}

/**
 * Rate Limiter Class
 */
export class RateLimiter {
  private attempts: Map<string, number[]> = new Map()

  /**
   * Check nếu request được phép
   */
  check(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now()
    const keyAttempts = this.attempts.get(key) || []

    // Remove old attempts (ngoài window)
    const recentAttempts = keyAttempts.filter((time) => now - time < config.windowMs)

    if (recentAttempts.length >= config.maxAttempts) {
      // Vượt quá limit
      const oldestAttempt = Math.min(...recentAttempts)
      const resetAt = oldestAttempt + config.windowMs
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      }
    }

    // Add current attempt
    recentAttempts.push(now)
    this.attempts.set(key, recentAttempts)

    return {
      allowed: true,
      remaining: config.maxAttempts - recentAttempts.length,
      resetAt: now + config.windowMs,
    }
  }

  /**
   * Reset attempts cho một key
   */
  reset(key: string): void {
    this.attempts.delete(key)
  }

  /**
   * Get remaining attempts
   */
  getRemaining(key: string, config: RateLimitConfig): number {
    const now = Date.now()
    const keyAttempts = this.attempts.get(key) || []
    const recentAttempts = keyAttempts.filter((time) => now - time < config.windowMs)
    return Math.max(0, config.maxAttempts - recentAttempts.length)
  }

  /**
   * Cleanup old entries (chạy định kỳ)
   */
  cleanup(): void {
    const now = Date.now()
    const maxAge = 60 * 60 * 1000 // 1 giờ

    for (const [key, attempts] of this.attempts.entries()) {
      const recentAttempts = attempts.filter((time) => now - time < maxAge)
      if (recentAttempts.length === 0) {
        this.attempts.delete(key)
      } else {
        this.attempts.set(key, recentAttempts)
      }
    }
  }
}

// Export instances
export const loginRateLimiter = new RateLimiter()
export const securityReportRateLimiter = new RateLimiter()
export const requestRateLimiter = new RateLimiter()

// Default configs
export const LOGIN_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 phút
  cooldownMs: 5 * 60 * 1000, // 5 phút cooldown
}

export const SECURITY_REPORT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 60 * 1000, // 1 phút
}

// Cleanup định kỳ (mỗi 10 phút)
export const RateLimitPresets = {
  STRICT: {
    maxAttempts: 10,
    windowMs: 60 * 1000,
  },
  NORMAL: {
    maxAttempts: 30,
    windowMs: 60 * 1000,
  },
} as const satisfies Record<string, RateLimitConfig>

export function getIdentifierFromRequest(request: RequestLike): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')?.trim()
  if (cfConnectingIp) {
    return `ip:${cfConnectingIp}`
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const firstForwardedIp = forwardedFor
    ?.split(',')
    .map((value) => value.trim())
    .find(Boolean)
  if (firstForwardedIp) {
    return `ip:${firstForwardedIp}`
  }

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) {
    return `ip:${realIp}`
  }

  return 'ip:unknown'
}

export function requireRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const result = requestRateLimiter.check(key, config)
  if (!result.allowed) {
    throw new Error(`RATE_LIMITED:${result.resetAt ?? Date.now()}`)
  }
  return result
}

const isNodeRuntime =
  typeof process !== 'undefined' &&
  typeof process.versions === 'object' &&
  !!process.versions?.node

if (isNodeRuntime && typeof setInterval !== 'undefined') {
  setInterval(() => {
    loginRateLimiter.cleanup()
    securityReportRateLimiter.cleanup()
    requestRateLimiter.cleanup()
  }, 10 * 60 * 1000)
}


