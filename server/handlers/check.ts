/**
 * POST /api/auth/check — Handle legacy check/login request
 */

import { json } from '../utils/json'
import type { Env } from '../env'
import { isPasswordHashed, verifyPassword } from '../utils/password'
import { handleSecurityReport } from '../security-report-endpoint'
import { requireRateLimit, getIdentifierFromRequest, RateLimitPresets } from '../../backend/security/rateLimiter'

export async function handleCheck(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting - strict for auth check (10 requests per minute)
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.STRICT)
  } catch (err: any) {
    return json({ allow: false, reason: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }
  const body = await request.json().catch(() => null)
  const { tai_khoan, mat_khau, ma_may, version } = body || {}

  if (!tai_khoan || !mat_khau || !ma_may) {
    return json({ error: 'Thiếu tai_khoan / mat_khau / ma_may' }, 400)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  // ============================================
  // EXISTING CHECK LOGIC (xác thực TRƯỚC, tracking SAU)
  // ============================================

  const row = await env.DB.prepare(
    `SELECT id, tai_khoan, mat_khau, ma_may, key_kich_hoat, key_status, trang_thai, license_expires_at
     FROM registrations
     WHERE tai_khoan = ?1
     ORDER BY thoi_gian_tao DESC
     LIMIT 1`
  )
    .bind(tai_khoan)
    .first<{
      id: string
      tai_khoan: string
      mat_khau: string
      ma_may: string
      key_kich_hoat: string | null
      key_status: string | null
      trang_thai: string
      license_expires_at: number | null
    }>()

  if (!row) {
    return json({ allow: false, reason: 'Tài khoản chưa đăng ký.' })
  }

  if (row.trang_thai === 'CHAN') {
    return json({ allow: false, reason: 'Tài khoản / máy này đã bị chặn.' })
  }

  if (row.trang_thai === 'CHO_DUYET') {
    return json({ allow: false, reason: 'Tài khoản đang chờ admin cấp quyền.' })
  }

  // CHO_PHEP — verify password TRƯỚC
  const isHashed = isPasswordHashed(row.mat_khau)

  let passwordValid = false
  if (isHashed) {
    const [storedHash, storedSalt] = row.mat_khau.split(':')
    passwordValid = await verifyPassword(mat_khau, storedHash, storedSalt)
  } else {
    passwordValid = row.mat_khau === mat_khau
  }

  if (!passwordValid) {
    return json({ allow: false, reason: 'Sai mật khẩu.' })
  }

  // Key status check — user bị revoke/lock key thì không cho đăng nhập
  if (row.key_status === 'REVOKED' || row.key_status === 'LOCKED') {
    return json({ allow: false, reason: 'Key đã bị thu hồi hoặc khóa. Vui lòng liên hệ admin.' })
  }

  // LICENSE EXPIRY CHECK — TRƯỚC mọi side effect (tracking, rebind)
  // NULL = vĩnh viễn (user cũ không bị ảnh hưởng)
  if (row.license_expires_at && row.license_expires_at < Date.now()) {
    return json({ allow: false, reason: 'Tài khoản đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.' })
  }

  // Update version SAU khi xác thực (tránh attacker overwrite version field)
  if (version) {
    await env.DB.prepare(
      `UPDATE registrations SET version = ?1 WHERE id = ?2`
    )
      .bind(version, row.id)
      .run()
  }

  // ============================================
  // Password đúng → TRACK MACHINE ID (sau khi xác thực)
  // Chỉ ghi tracking khi password đúng để tránh DoS attack:
  // attacker spam machineId khác nhau với username nạn nhân → tăng count → auto-block
  // ============================================
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO machine_id_tracking (username, machine_id, first_seen, last_seen, request_count)
     VALUES (?1, ?2, ?3, ?3, 1)
     ON CONFLICT(username, machine_id) DO UPDATE SET
       last_seen = ?3,
       request_count = request_count + 1`
  )
    .bind(tai_khoan, ma_may, now)
    .run()

  // ============================================
  // CHECK MULTIPLE MACHINE IDs (sau khi xác thực)
  // ============================================
  const machineCount = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM machine_id_tracking WHERE username = ?'
  )
    .bind(tai_khoan)
    .first<{ count: number }>()

  if (machineCount && machineCount.count > 1) {
    await handleSecurityReport(
      new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'MULTIPLE_MACHINE_IDS',
          severity: 'medium',
          message: `Account ${tai_khoan} using ${machineCount.count} different machine IDs`,
          details: {
            username: tai_khoan,
            machineCount: machineCount.count,
            currentMachineId: ma_may,
          },
          machineId: ma_may,
          username: tai_khoan,
          timestamp: now,
        }),
      }),
      env,
      { trustedSource: true },
    ).catch(() => {})

    // Auto-block chỉ khi > 5 machineIds (nâng từ 3 lên 5 để tránh false positive
    // do VPN/driver changes gây machineId thay đổi)
    if (machineCount.count > 5) {
      console.warn('[handleCheck] Multiple machine IDs detected, keeping account active in monitor-only mode:', {
        username: tai_khoan,
        machineCount: machineCount.count,
      })
    }
  }

  // ============================================
  // MACHINE ID CHECK — cho phép đổi máy nếu password đúng
  // ============================================
  const normalizedStoredMachineId = (row.ma_may || '').trim()
  const normalizedRequestMachineId = (ma_may || '').trim()

  if (normalizedStoredMachineId !== normalizedRequestMachineId) {
    console.warn('[handleCheck] Machine ID changed — updating:', {
      username: tai_khoan,
      old: normalizedStoredMachineId.substring(0, 16) + '...',
      new: normalizedRequestMachineId.substring(0, 16) + '...',
    })
    // Password đúng + tài khoản đã duyệt → cho phép đổi máy, cập nhật machineId mới
    // Ngăn chặn tình trạng user bị lock-out khi VPN/driver/Win11 làm machineId thay đổi
    await env.DB.prepare(
      'UPDATE registrations SET ma_may = ?1 WHERE id = ?2'
    )
      .bind(normalizedRequestMachineId, row.id)
      .run()
  }

  return json({
    allow: true,
    key_kich_hoat: row.key_kich_hoat,
    trang_thai: row.trang_thai,
  })
}
