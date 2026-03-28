/**
 * Security Monitoring & Alerting
 * Phát hiện và báo cáo các hoạt động đáng ngờ (crack attempts)
 */

import { getMachineHash } from '../license/machineId'

export type SecurityEventType =
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_REPLAY'
  | 'NONCE_REUSED'
  | 'TIMESTAMP_INVALID'
  | 'LICENSE_CHECK_FAILED'
  | 'TAMPERING_DETECTED'
  | 'ANTI_DEBUG_TRIGGERED'
  | 'MACHINE_ID_MISMATCH'
  | 'ENCRYPTION_DECRYPT_FAILED'
  | 'FILE_INTEGRITY_FAILED'
  | 'MULTIPLE_MACHINE_IDS'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNSAFE_ENVIRONMENT'

export interface SecurityEvent {
  type: SecurityEventType
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  details?: Record<string, any>
  timestamp: number
  machineId: string
  username?: string
}

// Cache để track các events gần đây (tránh spam)
const recentEvents: Map<string, number[]> = new Map()
const EVENT_WINDOW_MS = 60 * 1000 // 1 phút
const MAX_EVENTS_PER_WINDOW = 5

/**
 * Check nếu event này nên được report (rate limiting)
 */
function shouldReportEvent(eventType: SecurityEventType, machineId: string): boolean {
  const key = `${machineId}:${eventType}`
  const now = Date.now()
  const events = recentEvents.get(key) || []

  // Remove old events
  const recent = events.filter((time) => now - time < EVENT_WINDOW_MS)

  if (recent.length >= MAX_EVENTS_PER_WINDOW) {
    // Quá nhiều events trong window → không report để tránh spam
    return false
  }

  recent.push(now)
  recentEvents.set(key, recent)
  return true
}

/**
 * Report security event lên server
 */
export async function reportSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    // Chỉ report nếu không bị rate limit
    if (!shouldReportEvent(event.type, event.machineId)) {
      console.warn(`[SecurityMonitoring] Rate limited: ${event.type} for ${event.machineId}`)
      return
    }

    // Gửi lên server (endpoint mới)
    const response = await fetch('https://license-server.dungdong333.workers.dev/api/security/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: event.type,
        severity: event.severity,
        message: event.message,
        details: event.details,
        timestamp: event.timestamp,
        machineId: event.machineId,
        username: event.username,
        appVersion: '1.0.4',
      }),
    })

    if (!response.ok) {
      console.warn(`[SecurityMonitoring] Failed to report event: ${response.status}`)
    } else {
      console.log(`[SecurityMonitoring] Event reported: ${event.type} (${event.severity})`)
    }
  } catch (error: any) {
    // Không throw - chỉ log để không làm gián đoạn app
    console.warn(`[SecurityMonitoring] Failed to report security event:`, error.message)
  }
}

/**
 * Report signature invalid
 */
export async function reportSignatureInvalid(
  details: {
    path: string
    method: string
    expectedSignature?: string
    receivedSignature?: string
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'SIGNATURE_INVALID',
    severity: 'high',
    message: `Invalid signature detected for ${details.method} ${details.path}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report signature replay (timestamp quá cũ hoặc nonce reused)
 */
export async function reportSignatureReplay(
  details: {
    path: string
    method: string
    timestamp: number
    age: number
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'SIGNATURE_REPLAY',
    severity: 'high',
    message: `Possible replay attack detected: timestamp age ${details.age}ms`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report nonce reused
 */
export async function reportNonceReused(
  details: {
    path: string
    method: string
    nonce: string
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'NONCE_REUSED',
    severity: 'critical',
    message: `Nonce reused detected - possible replay attack`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report license check failed nhiều lần
 */
export async function reportLicenseCheckFailed(
  details: {
    reason: string
    status: string
    attemptCount?: number
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'LICENSE_CHECK_FAILED',
    severity: details.attemptCount && details.attemptCount > 5 ? 'high' : 'medium',
    message: `License check failed: ${details.reason}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report tampering detected
 */
export async function reportTamperingDetected(
  details: {
    reasons: string[]
    file?: string
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'TAMPERING_DETECTED',
    severity: 'critical',
    message: `Tampering detected: ${details.reasons.join(', ')}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report anti-debugging triggered
 */
export async function reportAntiDebugTriggered(
  details: {
    method: string
    detected: boolean
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'ANTI_DEBUG_TRIGGERED',
    severity: 'high',
    message: `Anti-debugging triggered: ${details.method}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report machine ID mismatch
 */
export async function reportMachineIdMismatch(
  details: {
    storedMachineId: string
    currentMachineId: string
    context: string
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'MACHINE_ID_MISMATCH',
    severity: 'high',
    message: `Machine ID mismatch in ${details.context}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report encryption/decryption failed
 */
export async function reportEncryptionFailed(
  details: {
    operation: 'encrypt' | 'decrypt'
    error: string
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'ENCRYPTION_DECRYPT_FAILED',
    severity: 'high',
    message: `${details.operation} failed: ${details.error}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report file integrity check failed
 */
export async function reportFileIntegrityFailed(
  details: {
    file: string
    expectedHash?: string
    actualHash?: string
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'FILE_INTEGRITY_FAILED',
    severity: 'critical',
    message: `File integrity check failed: ${details.file}`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Report multiple machine IDs cho cùng account
 */
export async function reportMultipleMachineIds(
  details: {
    username: string
    machineIds: string[]
    count: number
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'MULTIPLE_MACHINE_IDS',
    severity: 'high',
    message: `Account ${details.username} using ${details.count} different machine IDs`,
    details,
    timestamp: Date.now(),
    machineId,
    username: details.username,
  })
}

/**
 * Report rate limit exceeded
 */
export async function reportRateLimitExceeded(
  details: {
    endpoint: string
    count: number
    window: number
  }
): Promise<void> {
  const machineId = await getMachineHash()
  await reportSecurityEvent({
    type: 'RATE_LIMIT_EXCEEDED',
    severity: 'medium',
    message: `Rate limit exceeded: ${details.count} requests in ${details.window}ms`,
    details,
    timestamp: Date.now(),
    machineId,
  })
}

/**
 * Initialize security monitoring
 */
export function initSecurityMonitoring(): void {
  // Cleanup old events mỗi 5 phút
  setInterval(() => {
    const now = Date.now()
    for (const [key, events] of recentEvents.entries()) {
      const recent = events.filter((time) => now - time < EVENT_WINDOW_MS)
      if (recent.length === 0) {
        recentEvents.delete(key)
      } else {
        recentEvents.set(key, recent)
      }
    }
  }, 5 * 60 * 1000) // 5 phút
}


