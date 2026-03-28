/**
 * Rate Limiter
 * Giới hạn số lần thử trong một khoảng thời gian
 */

interface RateLimitConfig {
  maxAttempts: number
  windowMs: number
  cooldownMs?: number
}

interface RateLimitResult {
  allowed: boolean
  remaining?: number
  resetAt?: number
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
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    loginRateLimiter.cleanup()
    securityReportRateLimiter.cleanup()
  }, 10 * 60 * 1000)
}


