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

// FIX M24: Absolute maximum session lifetime — sessions cannot be renewed past this age.
// Even if the user is continuously active, they must re-authenticate after this period.
// This limits the damage window of a stolen session token.
const SESSION_ABSOLUTE_MAX_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000 // 180 ngày (6 months)

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

  // FIX M24: Enforce absolute max lifetime — session dies regardless of activity
  if (now - session.createdAt > SESSION_ABSOLUTE_MAX_LIFETIME_MS) {
    return false
  }

  return now < session.expiresAt
}

/**
 * Update session activity
 * Nếu cách lần cuối < ACTIVITY_THRESHOLD_MS, chỉ update lastActivity
 * Nếu cách lần cuối >= ACTIVITY_THRESHOLD_MS, extend expiresAt
 * FIX M24: Extension is capped — expiresAt cannot exceed createdAt + ABSOLUTE_MAX
 */
export function updateSessionActivity(session: SessionInfo): SessionInfo {
  const now = Date.now()
  const timeSinceLastActivity = now - session.lastActivity

  // FIX M24: If session has exceeded absolute max lifetime, don't extend
  if (now - session.createdAt > SESSION_ABSOLUTE_MAX_LIFETIME_MS) {
    return session // Return unchanged — isSessionValid will reject it
  }

  if (timeSinceLastActivity < ACTIVITY_THRESHOLD_MS) {
    // Activity gần đây, chỉ update lastActivity
    return {
      ...session,
      lastActivity: now,
    }
  } else {
    // Activity xa, extend session — but cap at absolute max lifetime
    const absoluteDeadline = session.createdAt + SESSION_ABSOLUTE_MAX_LIFETIME_MS
    const newExpiresAt = Math.min(now + SESSION_TIMEOUT_MS, absoluteDeadline)
    return {
      ...session,
      lastActivity: now,
      expiresAt: newExpiresAt,
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


