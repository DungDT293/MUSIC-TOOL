/**
 * Auth Flow V2 Handlers
 * 
 * New authentication endpoints for V2:
 * - check-status: Check registration status
 * - validate-key: Validate key and receive tokens
 * - validate-token: Validate device token
 * - refresh-token: Refresh device token
 * - login: Login with username/password
 */

import { json } from './index'
import { validatePayload } from '../backend/utils/validatePayload'
import { requireRateLimit, getIdentifierFromRequest, RateLimitPresets } from '../backend/security/rateLimiter'
import {
  ServerCheckStatusSchema,
  ServerValidateKeySchema,
  ServerValidateTokenSchema,
  ServerRefreshTokenSchema,
  ServerLoginSchema,
  ServerUnlockKeySchema,
  ServerRevokeKeySchema,
  ServerAllowRebindSchema,
} from '../shared/ipcSchemas'
import { generateToken, verifyToken, generateRefreshToken } from './utils/jwt'
// Import password functions from index.ts
// Note: These are not exported, so we'll duplicate the logic here
async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  try {
    const saltBytes = Uint8Array.from(atob(storedSalt), (c) => c.charCodeAt(0))
    const encoder = new TextEncoder()
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const saltBuffer = new ArrayBuffer(saltBytes.length)
    new Uint8Array(saltBuffer).set(saltBytes)
    const hashBuffer = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBuffer, iterations: 100000, hash: 'SHA-256' },
      passwordKey,
      256
    )
    const computedHash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    return computedHash === storedHash
  } catch {
    return false
  }
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const encoder = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const saltBuffer = new ArrayBuffer(saltBytes.length)
  new Uint8Array(saltBuffer).set(saltBytes)
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuffer, iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    256
  )
  const hash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
  const saltStr = btoa(String.fromCharCode(...saltBytes))
  return { hash, salt: saltStr }
}

function isPasswordHashed(password: string): boolean {
  // Hashed passwords are stored as "hash:salt" format
  // hash = base64 of 32 bytes (PBKDF2-SHA256) = 44 chars
  // salt = base64 of 16 bytes = 24 chars
  // Total = 44 + 1 + 24 = 69 chars
  if (!password || password.length !== 69) return false

  const parts = password.split(':')
  if (parts.length !== 2) return false
  if (parts[0].length !== 44 || parts[1].length !== 24) return false

  const base64Regex = /^[A-Za-z0-9+/]+=*$/
  return base64Regex.test(parts[0]) && base64Regex.test(parts[1])
}

interface Env {
  DB?: D1Database
  ADMIN_TOKEN?: string
  JWT_SECRET?: string
}

function normalizeActivationKeyForComparison(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, '')
}

function looksLikeUuidActivationKey(value: string): boolean {
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
}

function activationKeysMatch(storedKey: string | null | undefined, providedKey: string | null | undefined): boolean {
  const normalizedStored = normalizeActivationKeyForComparison(storedKey)
  const normalizedProvided = normalizeActivationKeyForComparison(providedKey)

  if (!normalizedStored || !normalizedProvided) {
    return false
  }

  if (looksLikeUuidActivationKey(normalizedStored) && looksLikeUuidActivationKey(normalizedProvided)) {
    return normalizedStored.toLowerCase() === normalizedProvided.toLowerCase()
  }

  return normalizedStored === normalizedProvided
}

/**
 * Write audit log helper
 */
async function writeAuditLog(
  db: D1Database,
  username: string,
  eventType: string,
  severity: 'info' | 'warning' | 'error' | 'critical',
  ipAddress: string,
  machineId: string,
  details: any
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO auth_audit_logs (id, username, event_type, severity, ip_address, machine_id, details, timestamp)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(
        crypto.randomUUID(),
        username,
        eventType,
        severity,
        ipAddress,
        machineId,
        JSON.stringify(details),
        Date.now()
      )
      .run()
  } catch (err) {
    // Ignore audit log errors (table might not exist if migration not run)
    console.warn(`[Audit] Failed to write ${eventType} log:`, err)
  }
}

async function autoRebindMachineId(
  db: D1Database,
  username: string,
  oldMachineId: string,
  newMachineId: string,
  ipAddress: string,
  context: string,
): Promise<void> {
  const normalizedOldMachineId = (oldMachineId || '').trim()
  const normalizedNewMachineId = (newMachineId || '').trim()
  if (!normalizedNewMachineId || normalizedOldMachineId === normalizedNewMachineId) {
    return
  }

  await db.prepare(
    `UPDATE registrations
     SET ma_may = ?1
     WHERE tai_khoan = ?2`
  )
    .bind(normalizedNewMachineId, username)
    .run()

  await writeAuditLog(db, username, 'MACHINE_REBIND_AUTO', 'warning', ipAddress, normalizedNewMachineId, {
    action: 'auto-rebind',
    context,
    oldMachineId: normalizedOldMachineId,
    newMachineId: normalizedNewMachineId,
  })
}

async function findRegistrationForAuth<T>(
  db: D1Database,
  selectClause: string,
  username: string,
  machineId?: string,
): Promise<T | null> {
  const normalizedUsername = (username || '').trim()
  const normalizedMachineId = (machineId || '').trim()

  if (normalizedMachineId) {
    const row = await db.prepare(
      `SELECT ${selectClause}
       FROM registrations
       WHERE tai_khoan = ?1 AND ma_may = ?2
       ORDER BY rowid DESC
       LIMIT 1`
    )
      .bind(normalizedUsername, normalizedMachineId)
      .first<T>()

    if (row) {
      return row
    }
  }

  return db.prepare(
    `SELECT ${selectClause}
     FROM registrations
     WHERE tai_khoan = ?1
     ORDER BY rowid DESC
     LIMIT 1`
  )
    .bind(normalizedUsername)
    .first<T>()
}

async function findRegistrationForValidateKey<T extends { key_kich_hoat: string | null; ma_may: string | null }>(
  db: D1Database,
  selectClause: string,
  username: string,
  activationKey: string,
  machineId?: string,
): Promise<T | null> {
  const normalizedUsername = (username || '').trim()
  const normalizedMachineId = (machineId || '').trim()
  const rowsResult = await db.prepare(
    `SELECT ${selectClause}
     FROM registrations
     WHERE tai_khoan = ?1
     ORDER BY rowid DESC`
  )
    .bind(normalizedUsername)
    .all<T>()

  const rows = rowsResult.results || []
  if (!rows.length) {
    return null
  }

  const keyMatchedRows = rows.filter((row) => activationKeysMatch(row.key_kich_hoat, activationKey))

  if (normalizedMachineId) {
    const machineAndKeyMatch = keyMatchedRows.find((row) => (row.ma_may || '').trim() === normalizedMachineId)
    if (machineAndKeyMatch) {
      return machineAndKeyMatch
    }
  }

  if (keyMatchedRows.length > 0) {
    return keyMatchedRows[0]
  }

  if (normalizedMachineId) {
    const machineMatchedRow = rows.find((row) => (row.ma_may || '').trim() === normalizedMachineId)
    if (machineMatchedRow) {
      return machineMatchedRow
    }
  }

  return rows[0]
}

/**
 * V2: Check tamper count and return action.
 * Monitor-only mode: keep warning signal, never hard-block user automatically.
 */
async function checkTamperAndGetAction(
  db: D1Database,
  username: string,
  machineId: string
): Promise<{ action: 'SUSPICIOUS' | 'BLOCKED' | null; tamperCount: number }> {
  try {
    // Count TAMPER events in last 24 hours
    const since = Date.now() - 24 * 60 * 60 * 1000
    const countResult = await db.prepare(
      `SELECT COUNT(*) as count FROM auth_audit_logs
       WHERE username = ? 
         AND machine_id = ?
         AND event_type = 'TAMPER'
         AND timestamp > ?`
    )
      .bind(username, machineId, since)
      .first<{ count: number }>()

    const tamperCount = countResult?.count || 0

    if (tamperCount > 0) {
      return { action: 'SUSPICIOUS', tamperCount }
    }

    return { action: null, tamperCount: 0 }
  } catch (err) {
    console.warn('[checkTamperAndGetAction] Error:', err)
    return { action: null, tamperCount: 0 }
  }
}

/**
 * V2: Report tamper event
 */
async function reportTamperEvent(
  db: D1Database,
  username: string,
  machineId: string,
  ipAddress: string,
  details: any
): Promise<void> {
  try {
    // Write audit log
    await writeAuditLog(db, username, 'TAMPER', 'error', ipAddress, machineId, details)

    // Also send security report (async, don't wait)
    import('./security-report-endpoint').then(({ handleSecurityReport }) => {
      handleSecurityReport(
        new Request('http://localhost/api/security/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'TAMPER',
            severity: 'high',
            message: `Tamper detected: ${details.reason || 'Machine ID mismatch'}`,
            machineId,
            username,
            timestamp: Date.now(),
            details,
          }),
        }),
        { DB: db },
        { trustedSource: true },
      ).catch(() => {})
    })
  } catch (err) {
    console.warn('[reportTamperEvent] Error:', err)
  }
}

/**
 * Handle check-status request
 * Check registration status (pending/approved/blocked)
 */
export async function handleCheckStatus(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.NORMAL)
  } catch (err: any) {
    return json({ error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerCheckStatusSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { tai_khoan, ma_may } = validated

  try {
    const row = await findRegistrationForAuth<{
      trang_thai: string
      key_status: string | null
      key_kich_hoat: string | null
      license_expires_at: number | null
    }>(
      env.DB,
      'trang_thai, key_status, key_kich_hoat, license_expires_at',
      tai_khoan,
      ma_may,
    )

    if (!row) {
      return json({ status: 'not_found', message: 'Không tìm thấy tài khoản.' })
    }

    // V2: Check status và key_status
    if (row.trang_thai === 'CHAN') {
      return json({ status: 'blocked', message: 'Tài khoản đã bị chặn.' })
    }

    if (row.trang_thai === 'CHO_DUYET') {
      return json({ status: 'pending', message: 'Đang chờ admin duyệt. Xin hãy kiên nhẫn.' })
    }

    // LICENSE EXPIRY CHECK — NULL = vĩnh viễn
    if (row.license_expires_at && row.license_expires_at < Date.now()) {
      return json({ status: 'expired', message: 'Tài khoản đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.' })
    }

    if (row.trang_thai === 'CHO_PHEP' && row.key_status === 'ACTIVE') {
      // V2: KHÔNG trả key về client
      return json({ status: 'approved', message: 'Vui lòng nhập key kích hoạt (lấy từ admin).' })
    }

    if (row.key_status === 'LOCKED') {
      return json({ status: 'locked', message: 'Key đã bị khóa. Vui lòng liên hệ admin để mở khóa.' })
    }

    if (row.key_status === 'REVOKED') {
      return json({ status: 'revoked', message: 'Key đã bị thu hồi. Vui lòng liên hệ admin.' })
    }

    return json({ status: 'pending', message: 'Đang chờ admin duyệt.' })
  } catch (err: any) {
    console.error('[handleCheckStatus] Error:', err)
    return json({ error: 'Lỗi khi kiểm tra trạng thái.' }, 500)
  }
}

/**
 * Handle validate-key request
 * Validate key và nhận tokens
 */
export async function handleValidateKey(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting - strict for key validation
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.STRICT)
  } catch (err: any) {
    return json({ error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerValidateKeySchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { tai_khoan, key_kich_hoat, ma_may } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    const row = await findRegistrationForValidateKey<{
      id: string
      key_kich_hoat: string | null
      key_status: string | null
      key_attempts: number | null
      ma_may: string
      trang_thai: string
      license_expires_at: number | null
    }>(
      env.DB,
      'id, key_kich_hoat, key_status, key_attempts, ma_may, trang_thai, license_expires_at',
      tai_khoan,
      key_kich_hoat,
      ma_may,
    )

    if (!row) {
      return json({ valid: false, message: 'Tài khoản không tồn tại.' })
    }

    // Check account status
    if (row.trang_thai !== 'CHO_PHEP') {
      return json({ valid: false, message: 'Tài khoản chưa được duyệt.' })
    }

    // Check key_status
    if (row.key_status === 'LOCKED') {
      await writeAuditLog(env.DB, tai_khoan, 'KEY_FAIL', 'warning', ipAddress, ma_may, {
        reason: 'Key is locked',
        attempts: row.key_attempts || 0,
      })
      return json({ valid: false, locked: true, message: 'Key đã bị khóa. Vui lòng liên hệ admin.' })
    }

    if (row.key_status === 'REVOKED') {
      await writeAuditLog(env.DB, tai_khoan, 'KEY_FAIL', 'warning', ipAddress, ma_may, {
        reason: 'Key is revoked',
      })
      return json({ valid: false, message: 'Key đã bị thu hồi. Vui lòng liên hệ admin.' })
    }

    // LICENSE EXPIRY CHECK — NULL = vĩnh viễn (user cũ không bị ảnh hưởng)
    if (row.license_expires_at && row.license_expires_at < now) {
      return json({ valid: false, message: 'Tài khoản đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.' })
    }

    // Check machineId
    const machineIdChangedForValidateKey = row.ma_may !== ma_may
    if (false && machineIdChangedForValidateKey) {
      // V2: Report tamper event
      await reportTamperEvent(env.DB, tai_khoan, ma_may, ipAddress, {
        reason: 'Machine ID mismatch',
        storedMachineId: row.ma_may,
        providedMachineId: ma_may,
        context: 'validate-key',
      })

      // V2: Check tamper count and get action
      const tamperCheck = await checkTamperAndGetAction(env.DB, tai_khoan, ma_may)

      if (tamperCheck.action === 'BLOCKED') {
        // Block account
        await env.DB.prepare('UPDATE registrations SET trang_thai = ? WHERE tai_khoan = ?')
          .bind('CHAN', tai_khoan)
          .run()

        return json({
          valid: false,
          action: 'BLOCKED',
          message: 'Tài khoản đã bị chặn do phát hiện can thiệp hệ thống. Vui lòng liên hệ admin.',
        })
      } else if (tamperCheck.action === 'SUSPICIOUS') {
        return json({
          valid: false,
          action: 'SUSPICIOUS',
          message: 'Cảnh báo: Phát hiện can thiệp hệ thống. Key chỉ hoạt động trên máy đã đăng ký.',
          tamperCount: tamperCheck.tamperCount,
        })
      }

      return json({ valid: false, message: 'Key chỉ hoạt động trên máy đã đăng ký.' })
    }

    // Check key
    if (!activationKeysMatch(row.key_kich_hoat, key_kich_hoat)) {
      // Increment attempts
      const newAttempts = (row.key_attempts || 0) + 1
      const shouldLock = newAttempts >= 5

      await env.DB.prepare(
        `UPDATE registrations 
         SET key_attempts = ?1, 
             last_key_attempt_at = ?2,
             key_status = CASE WHEN ?3 THEN 'LOCKED' ELSE key_status END,
             key_locked_at = CASE WHEN ?3 THEN ?2 ELSE key_locked_at END
         WHERE id = ?4`
      )
        .bind(newAttempts, now, shouldLock ? 1 : 0, row.id)
        .run()

      await writeAuditLog(env.DB, tai_khoan, 'KEY_FAIL', shouldLock ? 'error' : 'warning', ipAddress, ma_may, {
        attempts: newAttempts,
        locked: shouldLock,
      })

      if (shouldLock) {
        // Send security report
        // Note: handleSecurityReport is async, but we don't wait for it
        import('./security-report-endpoint').then(({ handleSecurityReport }) => {
          handleSecurityReport(
            new Request(request.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'KEY_LOCKED',
                severity: 'high',
                message: `Key locked after 5 failed attempts: ${tai_khoan}`,
                machineId: ma_may,
                username: tai_khoan,
                timestamp: now,
              }),
            }),
            env,
            { trustedSource: true },
          ).catch(() => {})
        })

        return json({
          valid: false,
          attempts: newAttempts,
          locked: true,
          message: 'Key đã bị khóa sau 5 lần thử sai. Vui lòng liên hệ admin.',
        })
      }

      const remaining = 5 - newAttempts
      return json({
        valid: false,
        attempts: newAttempts,
        locked: false,
        message: `Key không đúng. Còn ${remaining} lần thử.`,
      })
    }

    if (machineIdChangedForValidateKey) {
      await autoRebindMachineId(env.DB, tai_khoan, row.ma_may, ma_may, ipAddress, 'validate-key')
    }

    // Key is correct - generate tokens
    const deviceToken = await generateToken(
      {
        sub: tai_khoan,
        machine_id: ma_may,
        key_id: row.key_kich_hoat || undefined,
        type: 'device',
      },
      30 * 24 * 60 * 60, // 30 days
      env
    )

    const refreshToken = generateRefreshToken()
    const refreshExpiresAt = now + 90 * 24 * 60 * 60 * 1000 // 90 days in milliseconds
    const deviceExpiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds

    // Save tokens to database
    await env.DB.prepare(
      `UPDATE registrations 
       SET device_token = ?1,
           device_token_expires_at = ?2,
           refresh_token = ?3,
           refresh_token_expires_at = ?4,
           key_attempts = 0,
           key_status = 'ACTIVE',
           last_login_at = ?5,
           last_login_ip = ?6
       WHERE id = ?7`
    )
      .bind(deviceToken, deviceExpiresAt, refreshToken, refreshExpiresAt, now, ipAddress, row.id)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, tai_khoan, 'KEY_VALIDATE', 'info', ipAddress, ma_may, {
      success: true,
    })

    return json({
      valid: true,
      device_token: deviceToken,
      refresh_token: refreshToken,
      expires_at: deviceExpiresAt,
    })
  } catch (err: any) {
    console.error('[handleValidateKey] Error:', err)
    return json({ error: 'Lỗi khi xác thực key.' }, 500)
  }
}

/**
 * Handle validate-token request
 * Validate device token (when app starts)
 */
export async function handleValidateToken(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.NORMAL)
  } catch (err: any) {
    return json({ error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerValidateTokenSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { device_token, machine_id } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    // Verify token signature and expiration
    const verification = await verifyToken(device_token, env)
    
    if (!verification.valid || !verification.payload) {
      return json({ valid: false, error: verification.error || 'Token không hợp lệ.' })
    }

    const payload = verification.payload

    // Check machineId matches
    if (payload.machine_id !== machine_id) {
      await writeAuditLog(env.DB, payload.sub, 'TOKEN_MACHINE_MISMATCH', 'warning', ipAddress, machine_id, {
        tokenMachineId: payload.machine_id,
        providedMachineId: machine_id,
      })

      return json({
        valid: false,
        action: 'RELOGIN_REQUIRED',
        error: 'Machine ID da thay doi. Vui long dang nhap lai de cap nhat may.',
      })
    }

    if (false && payload.machine_id !== machine_id) {
      // V2: Report tamper event
      await reportTamperEvent(env.DB, payload.sub, machine_id, ipAddress, {
        reason: 'Machine ID mismatch',
        tokenMachineId: payload.machine_id,
        providedMachineId: machine_id,
        context: 'validate-token',
      })

      // V2: Check tamper count and get action
      const tamperCheck = await checkTamperAndGetAction(env.DB, payload.sub, machine_id)

      if (tamperCheck.action === 'BLOCKED') {
        // Block account
        await env.DB.prepare('UPDATE registrations SET trang_thai = ? WHERE tai_khoan = ?')
          .bind('CHAN', payload.sub)
          .run()

        return json({
          valid: false,
          action: 'BLOCKED',
          error: 'Tài khoản đã bị chặn do phát hiện can thiệp hệ thống. Vui lòng liên hệ admin.',
        })
      } else if (tamperCheck.action === 'SUSPICIOUS') {
        return json({
          valid: false,
          action: 'SUSPICIOUS',
          error: 'Cảnh báo: Phát hiện can thiệp hệ thống. Token không khớp với máy hiện tại.',
          tamperCount: tamperCheck.tamperCount,
        })
      }

      return json({ valid: false, error: 'Token không khớp với máy hiện tại.' })
    }

    // Check account status and key_status in database
    const row = await env.DB.prepare(
      'SELECT id, trang_thai, key_status, device_token_expires_at, license_expires_at FROM registrations WHERE tai_khoan = ? ORDER BY thoi_gian_tao DESC LIMIT 1'
    )
      .bind(payload.sub)
      .first<{ id: string; trang_thai: string; key_status: string | null; device_token_expires_at: number | null; license_expires_at: number | null }>()

    if (!row) {
      return json({ valid: false, error: 'Tài khoản không tồn tại.' })
    }

    // Check account status (CHAN = blocked)
    if (row.trang_thai === 'CHAN') {
      return json({ valid: false, error: 'Tài khoản đã bị chặn. Vui lòng liên hệ admin.' })
    }

    if (row.trang_thai !== 'CHO_PHEP') {
      return json({ valid: false, error: 'Tài khoản chưa được duyệt.' })
    }

    // Check key_status
    if (row.key_status === 'REVOKED' || row.key_status === 'LOCKED') {
      return json({ valid: false, error: 'Key đã bị thu hồi hoặc khóa.' })
    }

    // LICENSE EXPIRY CHECK — NULL = vĩnh viễn (user cũ không bị ảnh hưởng)
    if (row.license_expires_at && row.license_expires_at < now) {
      return json({ valid: false, error: 'Tài khoản đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.' })
    }

    // Check token expiry in database (double check)
    if (row.device_token_expires_at && row.device_token_expires_at < now) {
      return json({ valid: false, error: 'Token đã hết hạn.' })
    }

    // Update last_login
    await env.DB.prepare(
      `UPDATE registrations
       SET last_login_at = ?1, last_login_ip = ?2
       WHERE id = ?3`
    )
      .bind(now, ipAddress, row.id)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, payload.sub, 'LOGIN', 'info', ipAddress, machine_id, {
      method: 'token',
    })

    return json({
      valid: true,
      username: payload.sub,
      expires_at: payload.exp * 1000, // Convert to milliseconds
    })
  } catch (err: any) {
    console.error('[handleValidateToken] Error:', err)
    return json({ error: 'Lỗi khi xác thực token.' }, 500)
  }
}

/**
 * Handle refresh-token request
 * Refresh device token using refresh token
 */
export async function handleRefreshToken(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.NORMAL)
  } catch (err: any) {
    return json({ error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerRefreshTokenSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { refresh_token, machine_id } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    const row = await env.DB.prepare(
      `SELECT id, tai_khoan, key_kich_hoat, key_status, refresh_token_expires_at, ma_may, trang_thai, license_expires_at
       FROM registrations
       WHERE refresh_token = ?`
    )
      .bind(refresh_token)
      .first<{
        id: string
        tai_khoan: string
        key_kich_hoat: string | null
        key_status: string | null
        refresh_token_expires_at: number | null
        ma_may: string
        trang_thai: string
        license_expires_at: number | null
      }>()

    if (!row) {
      return json({ ok: false, error: 'Refresh token không hợp lệ.' })
    }

    // Check account status (CHAN = blocked)
    if (row.trang_thai === 'CHAN') {
      return json({ ok: false, error: 'Tài khoản đã bị chặn. Vui lòng liên hệ admin.' })
    }

    if (row.trang_thai !== 'CHO_PHEP') {
      return json({ ok: false, error: 'Tài khoản chưa được duyệt.' })
    }

    // LICENSE EXPIRY CHECK — NULL = vĩnh viễn
    if (row.license_expires_at && row.license_expires_at < now) {
      return json({ ok: false, error: 'Tài khoản đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.' })
    }

    // Check key_status
    if (row.key_status === 'REVOKED' || row.key_status === 'LOCKED') {
      return json({ ok: false, error: 'Key đã bị thu hồi hoặc khóa.' })
    }

    // Check refresh token expiry
    if (row.refresh_token_expires_at && row.refresh_token_expires_at < now) {
      return json({ ok: false, error: 'Refresh token đã hết hạn.' })
    }

    // Check machineId — SAU tất cả validation checks để tránh mutate data khi token hết hạn
    if (row.ma_may !== machine_id) {
      await autoRebindMachineId(env.DB, row.tai_khoan, row.ma_may, machine_id, ipAddress, 'refresh-token')
    }

    if (false && row.ma_may !== machine_id) {
      // V2: Report tamper event
      await reportTamperEvent(env.DB, row.tai_khoan, machine_id, ipAddress, {
        reason: 'Machine ID mismatch',
        storedMachineId: row.ma_may,
        providedMachineId: machine_id,
        context: 'refresh-token',
      })

      // V2: Check tamper count and get action
      const tamperCheck = await checkTamperAndGetAction(env.DB, row.tai_khoan, machine_id)

      if (tamperCheck.action === 'BLOCKED') {
        // Block account
        await env.DB.prepare('UPDATE registrations SET trang_thai = ? WHERE tai_khoan = ?')
          .bind('CHAN', row.tai_khoan)
          .run()

        return json({
          ok: false,
          action: 'BLOCKED',
          error: 'Tài khoản đã bị chặn do phát hiện can thiệp hệ thống. Vui lòng liên hệ admin.',
        })
      } else if (tamperCheck.action === 'SUSPICIOUS') {
        return json({
          ok: false,
          action: 'SUSPICIOUS',
          error: 'Cảnh báo: Phát hiện can thiệp hệ thống. Refresh token không khớp với máy hiện tại.',
          tamperCount: tamperCheck.tamperCount,
        })
      }

      return json({ ok: false, error: 'Refresh token không khớp với máy hiện tại.' })
    }

    // Generate new tokens
    const deviceToken = await generateToken(
      {
        sub: row.tai_khoan,
        machine_id: machine_id,
        key_id: row.key_kich_hoat || undefined,
        type: 'device',
      },
      30 * 24 * 60 * 60, // 30 days
      env
    )

    const newRefreshToken = generateRefreshToken()
    const refreshExpiresAt = now + 90 * 24 * 60 * 60 * 1000 // 90 days
    const deviceExpiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30 days

    // Save new tokens — use id (not tai_khoan) to avoid updating multiple rows
    await env.DB.prepare(
      `UPDATE registrations
       SET device_token = ?1,
           device_token_expires_at = ?2,
           refresh_token = ?3,
           refresh_token_expires_at = ?4,
           last_login_at = ?5,
           last_login_ip = ?6
       WHERE id = ?7`
    )
      .bind(deviceToken, deviceExpiresAt, newRefreshToken, refreshExpiresAt, now, ipAddress, row.id)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, row.tai_khoan, 'LOGIN', 'info', ipAddress, machine_id, {
      method: 'refresh_token',
    })

    return json({
      ok: true,
      device_token: deviceToken,
      refresh_token: newRefreshToken,
      expires_at: deviceExpiresAt,
    })
  } catch (err: any) {
    console.error('[handleRefreshToken] Error:', err)
    return json({ error: 'Lỗi khi refresh token.' }, 500)
  }
}

/**
 * Handle login request
 * Login with username/password (when token expires)
 */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.STRICT)
  } catch (err: any) {
    return json({ error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerLoginSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { tai_khoan, mat_khau, ma_may } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    const row = await findRegistrationForAuth<{
      id: string
      mat_khau: string
      trang_thai: string
      key_status: string | null
      ma_may: string
      key_kich_hoat: string | null
      license_expires_at: number | null
    }>(
      env.DB,
      'id, mat_khau, trang_thai, key_status, ma_may, key_kich_hoat, license_expires_at',
      tai_khoan,
      ma_may,
    )

    if (!row) {
      return json({ ok: false, error: 'Tài khoản hoặc mật khẩu không đúng.' })
    }

    // Check account status — phân biệt CHAN vs CHO_DUYET
    if (row.trang_thai === 'CHAN') {
      return json({ ok: false, error: 'Tài khoản đã bị chặn. Vui lòng liên hệ admin.' })
    }
    if (row.trang_thai !== 'CHO_PHEP') {
      return json({ ok: false, error: 'Tài khoản đang chờ admin cấp quyền.' })
    }

    // Verify password FIRST — trước khi check key_status/machineId để tránh information leak
    const isHashed = isPasswordHashed(row.mat_khau)
    let passwordValid = false

    if (isHashed) {
      const [storedHash, storedSalt] = row.mat_khau.split(':')
      passwordValid = await verifyPassword(mat_khau, storedHash, storedSalt)
    } else {
      // Plaintext comparison (không mã hóa mật khẩu user đã đặt)
      passwordValid = row.mat_khau === mat_khau
    }

    if (!passwordValid) {
      await writeAuditLog(env.DB, tai_khoan, 'LOGIN', 'warning', ipAddress, ma_may, {
        success: false,
        reason: 'Invalid password',
      })
      return json({ ok: false, error: 'Tài khoản hoặc mật khẩu không đúng.' })
    }

    // Check key_status — SAU password verify để không leak thông tin
    if (row.key_status === 'REVOKED' || row.key_status === 'LOCKED') {
      return json({ ok: false, error: 'Key đã bị thu hồi hoặc khóa.' })
    }

    // LICENSE EXPIRY CHECK — NULL = vĩnh viễn
    if (row.license_expires_at && row.license_expires_at < now) {
      return json({ ok: false, error: 'Tài khoản đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.' })
    }

    // Check machineId — chỉ sau khi password đã xác thực đúng
    if (row.ma_may !== ma_may) {
      await autoRebindMachineId(env.DB, tai_khoan, row.ma_may, ma_may, ipAddress, 'login')
    }

    if (false && row.ma_may !== ma_may) {
      // V2: Report tamper event
      await reportTamperEvent(env.DB, tai_khoan, ma_may, ipAddress, {
        reason: 'Machine ID mismatch',
        storedMachineId: row.ma_may,
        providedMachineId: ma_may,
        context: 'login',
      })

      // V2: Check tamper count and get action
      const tamperCheck = await checkTamperAndGetAction(env.DB, tai_khoan, ma_may)

      if (tamperCheck.action === 'BLOCKED') {
        // Block account
        await env.DB.prepare('UPDATE registrations SET trang_thai = ? WHERE tai_khoan = ?')
          .bind('CHAN', tai_khoan)
          .run()

        return json({
          ok: false,
          action: 'BLOCKED',
          error: 'Tài khoản đã bị chặn do phát hiện can thiệp hệ thống. Vui lòng liên hệ admin.',
        })
      } else if (tamperCheck.action === 'SUSPICIOUS') {
        return json({
          ok: false,
          action: 'SUSPICIOUS',
          error: 'Cảnh báo: Phát hiện can thiệp hệ thống. Tài khoản này chỉ được phép dùng trên 1 máy.',
        })
      }

      return json({ ok: false, error: 'Tài khoản này chỉ được phép dùng trên 1 máy.' })
    }

    // Generate new tokens
    const deviceToken = await generateToken(
      {
        sub: tai_khoan,
        machine_id: ma_may,
        key_id: row.key_kich_hoat || undefined,
        type: 'device',
      },
      30 * 24 * 60 * 60, // 30 days
      env
    )

    const refreshToken = generateRefreshToken()
    const refreshExpiresAt = now + 90 * 24 * 60 * 60 * 1000 // 90 days
    const deviceExpiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30 days

    // Save tokens
    await env.DB.prepare(
      `UPDATE registrations 
       SET device_token = ?1,
           device_token_expires_at = ?2,
           refresh_token = ?3,
           refresh_token_expires_at = ?4,
           last_login_at = ?5,
           last_login_ip = ?6
       WHERE id = ?7`
    )
      .bind(deviceToken, deviceExpiresAt, refreshToken, refreshExpiresAt, now, ipAddress, row.id)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, tai_khoan, 'LOGIN', 'info', ipAddress, ma_may, {
      success: true,
      method: 'password',
    })

    return json({
      ok: true,
      device_token: deviceToken,
      refresh_token: refreshToken,
      expires_at: deviceExpiresAt,
    })
  } catch (err: any) {
    console.error('[handleLogin] Error:', err)
    return json({ error: 'Lỗi khi đăng nhập.' }, 500)
  }
}

/**
 * V2: Admin - Unlock key
 * Unlock key sau khi bị lock (sau 5 failed attempts)
 */
export async function handleUnlockKey(request: Request, env: Env): Promise<Response> {
  // SECURITY: Require admin token
  const adminToken = request.headers.get('x-admin-token')
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return json({ error: 'Admin token required' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerUnlockKeySchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { tai_khoan } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    // Check user exists
    const row = await env.DB.prepare(
      'SELECT id, key_status, ma_may FROM registrations WHERE tai_khoan = ?'
    )
      .bind(tai_khoan)
      .first<{ id: string; key_status: string | null; ma_may: string }>()

    if (!row) {
      return json({ ok: false, error: 'Tài khoản không tồn tại.' })
    }

    // Check if key is locked
    if (row.key_status !== 'LOCKED') {
      return json({ ok: false, error: 'Key không bị khóa.' })
    }

    // Unlock key
    await env.DB.prepare(
      `UPDATE registrations 
       SET key_status = 'ACTIVE',
           key_attempts = 0,
           key_locked_at = NULL
       WHERE id = ?`
    )
      .bind(row.id)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, tai_khoan, 'KEY_UNLOCK', 'info', ipAddress, row.ma_may, {
      action: 'unlock',
      unlockedBy: 'admin',
    })

    return json({
      ok: true,
      message: 'Key đã được mở khóa thành công.',
    })
  } catch (err: any) {
    console.error('[handleUnlockKey] Error:', err)
    return json({ error: 'Lỗi khi mở khóa key.' }, 500)
  }
}

/**
 * V2: Admin - Revoke key
 * Revoke key và invalidate all tokens
 */
export async function handleRevokeKey(request: Request, env: Env): Promise<Response> {
  // SECURITY: Require admin token
  const adminToken = request.headers.get('x-admin-token')
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return json({ error: 'Admin token required' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerRevokeKeySchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { tai_khoan } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    // Check user exists
    const row = await env.DB.prepare(
      'SELECT id, key_status, ma_may FROM registrations WHERE tai_khoan = ?'
    )
      .bind(tai_khoan)
      .first<{ id: string; key_status: string | null; ma_may: string }>()

    if (!row) {
      return json({ ok: false, error: 'Tài khoản không tồn tại.' })
    }

    // Revoke key and invalidate tokens
    await env.DB.prepare(
      `UPDATE registrations 
       SET key_status = 'REVOKED',
           device_token = NULL,
           device_token_expires_at = NULL,
           refresh_token = NULL,
           refresh_token_expires_at = NULL
       WHERE id = ?`
    )
      .bind(row.id)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, tai_khoan, 'KEY_REVOKE', 'warning', ipAddress, row.ma_may, {
      action: 'revoke',
      revokedBy: 'admin',
    })

    return json({
      ok: true,
      message: 'Key đã bị thu hồi. Tất cả tokens đã bị vô hiệu hóa.',
    })
  } catch (err: any) {
    console.error('[handleRevokeKey] Error:', err)
    return json({ error: 'Lỗi khi thu hồi key.' }, 500)
  }
}

/**
 * V2: Admin - Allow machine rebind
 * Cho phép đổi machineId (1 lần)
 */
export async function handleAllowRebind(request: Request, env: Env): Promise<Response> {
  // SECURITY: Require admin token
  const adminToken = request.headers.get('x-admin-token')
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return json({ error: 'Admin token required' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerAllowRebindSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { tai_khoan, new_machine_id } = validated
  const ipAddress = getIdentifierFromRequest(request).replace('ip:', '')
  const now = Date.now()

  try {
    // Check user exists
    const row = await env.DB.prepare(
      'SELECT id, ma_may FROM registrations WHERE tai_khoan = ?'
    )
      .bind(tai_khoan)
      .first<{ id: string; ma_may: string }>()

    if (!row) {
      return json({ ok: false, error: 'Tài khoản không tồn tại.' })
    }

    const oldMachineId = row.ma_may

    // Update machineId + invalidate old tokens in single atomic UPDATE
    await env.DB.prepare(
      `UPDATE registrations
       SET ma_may = ?1,
           device_token = NULL,
           device_token_expires_at = NULL,
           refresh_token = NULL,
           refresh_token_expires_at = NULL
       WHERE id = ?2`
    )
      .bind(new_machine_id, row.id)
      .run()

    // FIX: Clear machine_id_tracking to prevent false-positive MULTIPLE_MACHINE_IDS alerts
    await env.DB.prepare(
      'DELETE FROM machine_id_tracking WHERE username = ?'
    )
      .bind(tai_khoan)
      .run()

    // Write audit log
    await writeAuditLog(env.DB, tai_khoan, 'MACHINE_REBIND', 'info', ipAddress, new_machine_id, {
      action: 'rebind',
      oldMachineId,
      newMachineId: new_machine_id,
      rebindBy: 'admin',
    })

    return json({
      ok: true,
      message: 'Đã cho phép đổi machineId. User cần đăng nhập lại với machineId mới.',
    })
  } catch (err: any) {
    console.error('[handleAllowRebind] Error:', err)
    return json({ error: 'Lỗi khi cho phép đổi machineId.' }, 500)
  }
}
