/**
 * Session Manager
 * Quản lý session timeout và activity tracking
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
var ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000; // 5 phút (coi là activity nếu cách lần cuối < 5 phút)
/**
 * Tạo session mới
 */
export function createSession() {
    var now = Date.now();
    return {
        createdAt: now,
        lastActivity: now,
        expiresAt: now + SESSION_TIMEOUT_MS,
    };
}
/**
 * Check nếu session còn valid
 */
export function isSessionValid(session) {
    if (!session) {
        return false;
    }
    var now = Date.now();
    return now < session.expiresAt;
}
/**
 * Update session activity
 * Nếu cách lần cuối < ACTIVITY_THRESHOLD_MS, chỉ update lastActivity
 * Nếu cách lần cuối >= ACTIVITY_THRESHOLD_MS, extend expiresAt
 */
export function updateSessionActivity(session) {
    var now = Date.now();
    var timeSinceLastActivity = now - session.lastActivity;
    if (timeSinceLastActivity < ACTIVITY_THRESHOLD_MS) {
        // Activity gần đây, chỉ update lastActivity
        return __assign(__assign({}, session), { lastActivity: now });
    }
    else {
        // Activity xa, extend session
        return __assign(__assign({}, session), { lastActivity: now, expiresAt: now + SESSION_TIMEOUT_MS });
    }
}
/**
 * Get session age (in milliseconds)
 */
export function getSessionAge(session) {
    return Date.now() - session.createdAt;
}
/**
 * Get time until session expires (in milliseconds)
 */
export function getTimeUntilExpiry(session) {
    var now = Date.now();
    return Math.max(0, session.expiresAt - now);
}
/**
 * Check nếu session sắp expire (trong vòng 7 ngày)
 */
export function isSessionExpiringSoon(session) {
    var timeUntilExpiry = getTimeUntilExpiry(session);
    var sevenDays = 7 * 24 * 60 * 60 * 1000;
    return timeUntilExpiry > 0 && timeUntilExpiry < sevenDays;
}
