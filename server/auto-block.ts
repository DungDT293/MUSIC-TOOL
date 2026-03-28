/// <reference path="./types.d.ts" />

/**
 * Auto-Block Mechanism
 * Tự động block khi phát hiện crack attempts
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
  threshold: number // Số events trong timeWindow
  timeWindow: number // ms
  action: 'block' | 'warn' | 'revoke_license'
}

const AUTO_BLOCK_RULES: AutoBlockRule[] = [
  {
    eventType: 'NONCE_REUSED',
    severity: 'critical',
    threshold: 1, // Block ngay lập tức
    timeWindow: 60 * 1000, // 1 phút
    action: 'block',
  },
  {
    eventType: 'TAMPERING_DETECTED',
    severity: 'critical',
    threshold: 1,
    timeWindow: 60 * 1000,
    action: 'block',
  },
  {
    eventType: 'FILE_INTEGRITY_FAILED',
    severity: 'critical',
    threshold: 1,
    timeWindow: 60 * 1000,
    action: 'block',
  },
  {
    eventType: 'SIGNATURE_INVALID',
    severity: 'high',
    threshold: 5, // 5 lần trong 5 phút
    timeWindow: 5 * 60 * 1000,
    action: 'block',
  },
  {
    eventType: 'SIGNATURE_REPLAY',
    severity: 'high',
    threshold: 3,
    timeWindow: 5 * 60 * 1000,
    action: 'block',
  },
  {
    eventType: 'LICENSE_CHECK_FAILED',
    severity: 'high',
    threshold: 10, // 10 lần trong 10 phút
    timeWindow: 10 * 60 * 1000,
    action: 'revoke_license',
  },
  {
    eventType: 'MACHINE_ID_MISMATCH',
    severity: 'high',
    threshold: 3,
    timeWindow: 10 * 60 * 1000,
    action: 'block',
  },
]

interface AutoBlockResult {
  blocked: boolean
  reason?: string
  action?: string
}

/**
 * Check và auto-block dựa trên rules
 */
export async function checkAndAutoBlock(
  event: SecurityEvent,
  env: Env
): Promise<AutoBlockResult> {
  if (!env.DB) {
    return { blocked: false } // Skip nếu không có DB
  }

  try {
    // 1. Tìm rule phù hợp
    const rule = AUTO_BLOCK_RULES.find(
      (r) => r.eventType === event.event && r.severity === event.severity
    )

    if (!rule) {
      return { blocked: false }
    }

    // 2. Đếm events trong timeWindow
    const since = Date.now() - rule.timeWindow
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM security_events
       WHERE machine_id = ? 
         AND event_type = ?
         AND severity = ?
         AND timestamp > ?`
    )
      .bind(event.machineId, event.event, event.severity, since)
      .first<{ count: number }>()

    const count = countResult?.count || 0

    // 3. Check threshold
    if (count >= rule.threshold) {
      // 4. Execute action
      switch (rule.action) {
        case 'block':
          await blockMachineId(event.machineId, env)
          return {
            blocked: true,
            reason: `Auto-blocked: ${count} ${event.event} events in ${rule.timeWindow / 1000}s`,
            action: 'block',
          }

        case 'revoke_license':
          await revokeLicenseForMachineId(event.machineId, env)
          return {
            blocked: true,
            reason: `License revoked: ${count} ${event.event} events in ${rule.timeWindow / 1000}s`,
            action: 'revoke_license',
          }

        case 'warn':
          // Chỉ log warning, không block
          console.warn(`[Auto-Block] Warning: ${count} ${event.event} events for ${event.machineId}`)
          return { blocked: false }
      }
    }

    return { blocked: false }
  } catch (error: any) {
    console.error('[Auto-Block] Error checking auto-block:', error)
    return { blocked: false }
  }
}

/**
 * Block machineId
 */
async function blockMachineId(machineId: string, env: Env): Promise<void> {
  if (!env.DB) {
    return
  }

  try {
    // Block trong database
    await env.DB.prepare(
      `UPDATE registrations 
       SET trang_thai = 'CHAN'
       WHERE ma_may = ?`
    )
      .bind(machineId)
      .run()

    console.log(`[Auto-Block] Blocked machineId: ${machineId.substring(0, 16)}...`)
  } catch (error) {
    console.error('[Auto-Block] Failed to block machineId:', error)
  }
}

/**
 * Revoke license cho machineId
 */
async function revokeLicenseForMachineId(machineId: string, env: Env): Promise<void> {
  if (!env.DB) {
    return
  }

  try {
    await env.DB.prepare(
      `UPDATE registrations 
       SET trang_thai = 'CHAN', key_kich_hoat = NULL
       WHERE ma_may = ?`
    )
      .bind(machineId)
      .run()

    console.log(`[Auto-Block] Revoked license for machineId: ${machineId.substring(0, 16)}...`)
  } catch (error) {
    console.error('[Auto-Block] Failed to revoke license:', error)
  }
}

/**
 * Get auto-block rules (for admin dashboard)
 */
export function getAutoBlockRules(): AutoBlockRule[] {
  return AUTO_BLOCK_RULES
}

