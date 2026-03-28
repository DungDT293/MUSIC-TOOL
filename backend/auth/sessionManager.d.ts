/**
 * Session Manager
 * Quản lý session timeout và activity tracking
 */
export interface SessionInfo {
    createdAt: number;
    lastActivity: number;
    expiresAt: number;
}
/**
 * Tạo session mới
 */
export declare function createSession(): SessionInfo;
/**
 * Check nếu session còn valid
 */
export declare function isSessionValid(session: SessionInfo | null | undefined): boolean;
/**
 * Update session activity
 * Nếu cách lần cuối < ACTIVITY_THRESHOLD_MS, chỉ update lastActivity
 * Nếu cách lần cuối >= ACTIVITY_THRESHOLD_MS, extend expiresAt
 */
export declare function updateSessionActivity(session: SessionInfo): SessionInfo;
/**
 * Get session age (in milliseconds)
 */
export declare function getSessionAge(session: SessionInfo): number;
/**
 * Get time until session expires (in milliseconds)
 */
export declare function getTimeUntilExpiry(session: SessionInfo): number;
/**
 * Check nếu session sắp expire (trong vòng 7 ngày)
 */
export declare function isSessionExpiringSoon(session: SessionInfo): boolean;
