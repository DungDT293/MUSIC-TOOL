/**
 * Rate Limiter
 * Giới hạn số lần thử trong một khoảng thời gian
 */
interface RateLimitConfig {
    maxAttempts: number;
    windowMs: number;
    cooldownMs?: number;
}
interface RateLimitResult {
    allowed: boolean;
    remaining?: number;
    resetAt?: number;
}
/**
 * Rate Limiter Class
 */
export declare class RateLimiter {
    private attempts;
    /**
     * Check nếu request được phép
     */
    check(key: string, config: RateLimitConfig): RateLimitResult;
    /**
     * Reset attempts cho một key
     */
    reset(key: string): void;
    /**
     * Get remaining attempts
     */
    getRemaining(key: string, config: RateLimitConfig): number;
    /**
     * Cleanup old entries (chạy định kỳ)
     */
    cleanup(): void;
}
export declare const loginRateLimiter: RateLimiter;
export declare const securityReportRateLimiter: RateLimiter;
export declare const LOGIN_RATE_LIMIT_CONFIG: RateLimitConfig;
export declare const SECURITY_REPORT_RATE_LIMIT_CONFIG: RateLimitConfig;
export {};
