/// <reference path="./types.d.ts" />

/**
 * Security Alert Rules
 * Chỉ cảnh báo cho admin, không tự động chặn user.
 */

interface SecurityEvent {
  event: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  machineId: string
  username?: string
  timestamp: number
}

interface Env {
  DB?: D1Database
}

interface AutoBlockRule {
  eventType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  threshold: number
  timeWindow: number
  action: 'warn'
}

const AUTO_BLOCK_RULES: AutoBlockRule[] = [
  {
    eventType: 'NONCE_REUSED',
    severity: 'critical',
    threshold: 1,
    timeWindow: 60 * 1000,
    action: 'warn',
  },
  {
    eventType: 'TAMPERING_DETECTED',
    severity: 'critical',
    threshold: 1,
    timeWindow: 60 * 1000,
    action: 'warn',
  },
  {
    eventType: 'FILE_INTEGRITY_FAILED',
    severity: 'critical',
    threshold: 1,
    timeWindow: 60 * 1000,
    action: 'warn',
  },
  {
    eventType: 'SIGNATURE_INVALID',
    severity: 'high',
    threshold: 5,
    timeWindow: 5 * 60 * 1000,
    action: 'warn',
  },
  {
    eventType: 'SIGNATURE_REPLAY',
    severity: 'high',
    threshold: 3,
    timeWindow: 5 * 60 * 1000,
    action: 'warn',
  },
  {
    eventType: 'LICENSE_CHECK_FAILED',
    severity: 'high',
    threshold: 10,
    timeWindow: 10 * 60 * 1000,
    action: 'warn',
  },
  {
    eventType: 'MACHINE_ID_MISMATCH',
    severity: 'high',
    threshold: 3,
    timeWindow: 10 * 60 * 1000,
    action: 'warn',
  },
]

interface AutoBlockResult {
  blocked: boolean
  reason?: string
  action?: 'warn'
}

/**
 * Giữ API cũ để server gọi lại không vỡ,
 * nhưng chỉ trả warning thay vì chặn.
 */
export async function checkAndAutoBlock(
  event: SecurityEvent,
  env: Env,
): Promise<AutoBlockResult> {
  if (!env.DB) {
    return { blocked: false }
  }

  try {
    const rule = AUTO_BLOCK_RULES.find(
      (candidate) => candidate.eventType === event.event && candidate.severity === event.severity,
    )

    if (!rule) {
      return { blocked: false }
    }

    const since = Date.now() - rule.timeWindow
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM security_events
       WHERE machine_id = ?
         AND event_type = ?
         AND severity = ?
         AND timestamp > ?`,
    )
      .bind(event.machineId, event.event, event.severity, since)
      .first<{ count: number }>()

    const count = countResult?.count || 0
    if (count < rule.threshold) {
      return { blocked: false }
    }

    console.warn(`[Security Alert] Warning: ${count} ${event.event} events for ${event.machineId}`)
    return {
      blocked: false,
      reason: `Warning only: ${count} ${event.event} events in ${rule.timeWindow / 1000}s`,
      action: 'warn',
    }
  } catch (error: any) {
    console.error('[Security Alert] Error checking rules:', error)
    return { blocked: false }
  }
}

export function getAutoBlockRules(): AutoBlockRule[] {
  return AUTO_BLOCK_RULES
}
