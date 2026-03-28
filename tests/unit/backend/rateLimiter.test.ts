/**
 * tests/unit/backend/rateLimiter.test.ts
 * Unit tests cho RateLimiter — login throttling, reset, cleanup
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RateLimiter, LOGIN_RATE_LIMIT_CONFIG } from '../../../backend/security/rateLimiter'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── Basic allow / block ──────────────────────────────────────────────────

  it('allows first attempt', () => {
    const result = limiter.check('user1', LOGIN_RATE_LIMIT_CONFIG)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4) // 5 max - 1 used
  })

  it('counts down remaining on each attempt', () => {
    const cfg = LOGIN_RATE_LIMIT_CONFIG
    for (let i = 1; i <= 4; i++) {
      const r = limiter.check('user1', cfg)
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(5 - i)
    }
  })

  it('blocks after maxAttempts (5) reached', () => {
    const cfg = LOGIN_RATE_LIMIT_CONFIG
    for (let i = 0; i < 5; i++) limiter.check('user1', cfg)
    const blocked = limiter.check('user1', cfg)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetAt).toBeGreaterThan(Date.now())
  })

  it('does NOT block different keys independently', () => {
    const cfg = LOGIN_RATE_LIMIT_CONFIG
    for (let i = 0; i < 5; i++) limiter.check('user1', cfg)
    // user2 should still be allowed
    const r = limiter.check('user2', cfg)
    expect(r.allowed).toBe(true)
  })

  // ─── Reset ────────────────────────────────────────────────────────────────

  it('reset() clears attempt history for key', () => {
    const cfg = LOGIN_RATE_LIMIT_CONFIG
    for (let i = 0; i < 5; i++) limiter.check('user1', cfg)
    expect(limiter.check('user1', cfg).allowed).toBe(false)

    limiter.reset('user1')
    expect(limiter.check('user1', cfg).allowed).toBe(true)
  })

  it('reset() does not affect other keys', () => {
    const cfg = LOGIN_RATE_LIMIT_CONFIG
    for (let i = 0; i < 5; i++) limiter.check('user1', cfg)
    for (let i = 0; i < 5; i++) limiter.check('user2', cfg)

    limiter.reset('user1')
    expect(limiter.check('user1', cfg).allowed).toBe(true)
    expect(limiter.check('user2', cfg).allowed).toBe(false)
  })

  // ─── Window expiry ────────────────────────────────────────────────────────

  it('allows again after window expires', () => {
    const cfg = { maxAttempts: 3, windowMs: 1000 }
    for (let i = 0; i < 3; i++) limiter.check('user1', cfg)
    expect(limiter.check('user1', cfg).allowed).toBe(false)

    // Advance time past window
    vi.advanceTimersByTime(1001)
    expect(limiter.check('user1', cfg).allowed).toBe(true)
  })

  // ─── getRemaining ─────────────────────────────────────────────────────────

  it('getRemaining returns correct count', () => {
    const cfg = LOGIN_RATE_LIMIT_CONFIG
    expect(limiter.getRemaining('user1', cfg)).toBe(5)
    limiter.check('user1', cfg)
    limiter.check('user1', cfg)
    expect(limiter.getRemaining('user1', cfg)).toBe(3)
  })

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  it('cleanup removes expired entries', () => {
    const cfg = { maxAttempts: 3, windowMs: 100 }
    limiter.check('user1', cfg)
    limiter.check('user2', cfg)

    vi.advanceTimersByTime(60 * 60 * 1000 + 1) // past 1h cleanup window
    limiter.cleanup()

    // After cleanup, both should be allowed again (entries removed)
    expect(limiter.check('user1', cfg).allowed).toBe(true)
    expect(limiter.check('user2', cfg).allowed).toBe(true)
  })

  // ─── Edge cases ───────────────────────────────────────────────────────────

  it('handles maxAttempts=1 correctly', () => {
    const cfg = { maxAttempts: 1, windowMs: 60_000 }
    const first = limiter.check('user1', cfg)
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(0)
    const second = limiter.check('user1', cfg)
    expect(second.allowed).toBe(false)
  })

  it('resetAt is approximately now + windowMs', () => {
    const cfg = { maxAttempts: 1, windowMs: 60_000 }
    limiter.check('user1', cfg) // use up the 1 attempt
    const r = limiter.check('user1', cfg)
    const expectedReset = Date.now() + cfg.windowMs
    expect(r.resetAt).toBeGreaterThan(Date.now())
    expect(r.resetAt!).toBeLessThanOrEqual(expectedReset + 100) // 100ms tolerance
  })
})
