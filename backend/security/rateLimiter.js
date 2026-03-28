/**
 * Rate Limiter
 * Giới hạn số lần thử trong một khoảng thời gian
 */
/**
 * Rate Limiter Class
 */
var RateLimiter = /** @class */ (function () {
    function RateLimiter() {
        this.attempts = new Map();
    }
    /**
     * Check nếu request được phép
     */
    RateLimiter.prototype.check = function (key, config) {
        var now = Date.now();
        var keyAttempts = this.attempts.get(key) || [];
        // Remove old attempts (ngoài window)
        var recentAttempts = keyAttempts.filter(function (time) { return now - time < config.windowMs; });
        if (recentAttempts.length >= config.maxAttempts) {
            // Vượt quá limit
            var oldestAttempt = Math.min.apply(Math, recentAttempts);
            var resetAt = oldestAttempt + config.windowMs;
            return {
                allowed: false,
                remaining: 0,
                resetAt: resetAt,
            };
        }
        // Add current attempt
        recentAttempts.push(now);
        this.attempts.set(key, recentAttempts);
        return {
            allowed: true,
            remaining: config.maxAttempts - recentAttempts.length,
            resetAt: now + config.windowMs,
        };
    };
    /**
     * Reset attempts cho một key
     */
    RateLimiter.prototype.reset = function (key) {
        this.attempts.delete(key);
    };
    /**
     * Get remaining attempts
     */
    RateLimiter.prototype.getRemaining = function (key, config) {
        var now = Date.now();
        var keyAttempts = this.attempts.get(key) || [];
        var recentAttempts = keyAttempts.filter(function (time) { return now - time < config.windowMs; });
        return Math.max(0, config.maxAttempts - recentAttempts.length);
    };
    /**
     * Cleanup old entries (chạy định kỳ)
     */
    RateLimiter.prototype.cleanup = function () {
        var now = Date.now();
        var maxAge = 60 * 60 * 1000; // 1 giờ
        for (var _i = 0, _a = this.attempts.entries(); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], attempts = _b[1];
            var recentAttempts = attempts.filter(function (time) { return now - time < maxAge; });
            if (recentAttempts.length === 0) {
                this.attempts.delete(key);
            }
            else {
                this.attempts.set(key, recentAttempts);
            }
        }
    };
    return RateLimiter;
}());
export { RateLimiter };
// Export instances
export var loginRateLimiter = new RateLimiter();
export var securityReportRateLimiter = new RateLimiter();
// Default configs
export var LOGIN_RATE_LIMIT_CONFIG = {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 phút
    cooldownMs: 5 * 60 * 1000, // 5 phút cooldown
};
export var SECURITY_REPORT_RATE_LIMIT_CONFIG = {
    maxAttempts: 10,
    windowMs: 60 * 1000, // 1 phút
};
// Cleanup định kỳ (mỗi 10 phút)
if (typeof setInterval !== 'undefined') {
    setInterval(function () {
        loginRateLimiter.cleanup();
        securityReportRateLimiter.cleanup();
    }, 10 * 60 * 1000);
}
