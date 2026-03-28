/**
 * Session Manager
 * Quản lý session timeout và activity tracking
 */

export interface SessionInfo {
  createdAt: number
  lastActivity: number
  expiresAt: number
}

const SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000 // 30 ngày
const ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000 // 5 phút (coi là activity nếu cách lần cuối < 5 phút)

/**
 * Tạo session mới
 */
export function createSession(): SessionInfo {
  const now = Date.now()
  return {
    createdAt: now,
    lastActivity: now,
    expiresAt: now + SESSION_TIMEOUT_MS,
  }
}

/**
 * Check nếu session còn valid
 */
export function isSessionValid(session: SessionInfo | null | undefined): boolean {
  if (!session) {
    return false
  }

  const now = Date.now()
  return now < session.expiresAt
}

/**
 * Update session activity
 * Nếu cách lần cuối < ACTIVITY_THRESHOLD_MS, chỉ update lastActivity
 * Nếu cách lần cuối >= ACTIVITY_THRESHOLD_MS, extend expiresAt
 */
export function updateSessionActivity(session: SessionInfo): SessionInfo {
  const now = Date.now()
  const timeSinceLastActivity = now - session.lastActivity

  if (timeSinceLastActivity < ACTIVITY_THRESHOLD_MS) {
    // Activity gần đây, chỉ update lastActivity
    return {
      ...session,
      lastActivity: now,
    }
  } else {
    // Activity xa, extend session
    return {
      ...session,
      lastActivity: now,
      expiresAt: now + SESSION_TIMEOUT_MS,
    }
  }
}

/**
 * Get session age (in milliseconds)
 */
export function getSessionAge(session: SessionInfo): number {
  return Date.now() - session.createdAt
}

/**
 * Get time until session expires (in milliseconds)
 */
export function getTimeUntilExpiry(session: SessionInfo): number {
  const now = Date.now()
  return Math.max(0, session.expiresAt - now)
}

/**
 * Check nếu session sắp expire (trong vòng 7 ngày)
 */
export function isSessionExpiringSoon(session: SessionInfo): boolean {
  const timeUntilExpiry = getTimeUntilExpiry(session)
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return timeUntilExpiry > 0 && timeUntilExpiry < sevenDays
}


