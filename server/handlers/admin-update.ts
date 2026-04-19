/**
 * POST /api/auth/admin/update — Handle legacy admin approve/block
 */

import { json } from '../utils/json'
import type { Env } from '../env'
import { getIdentifierFromRequest } from '../../backend/security/rateLimiter'
import { validatePayload } from '../../backend/utils/validatePayload'
import { ServerAdminUpdateSchema } from '../../shared/ipcSchemas'

export async function handleAdminUpdate(request: Request, env: Env): Promise<Response> {
  const adminToken = request.headers.get('x-admin-token')
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return json({ error: 'Admin token invalid' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)

  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerAdminUpdateSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }

  const { id, hanh_dong } = validated

  // V2: Key đã được tạo khi đăng ký, chỉ cần update status
  // Nếu admin approve, set key_status='ACTIVE'
  if (hanh_dong === 'CHO_PHEP') {
    await env.DB.prepare(
      `UPDATE registrations
       SET trang_thai = ?1,
           key_status = 'ACTIVE'
       WHERE id = ?2`
    )
      .bind(hanh_dong, id)
      .run()

    // V2: Ghi audit log
    try {
      const user = await env.DB.prepare('SELECT tai_khoan, ma_may FROM registrations WHERE id = ?')
        .bind(id)
        .first<{ tai_khoan: string; ma_may: string }>()

      if (user) {
        // Get key to include in audit log
        const userWithKey = await env.DB.prepare('SELECT key_kich_hoat FROM registrations WHERE id = ?')
          .bind(id)
          .first<{ key_kich_hoat: string | null }>()

        await env.DB.prepare(
          `INSERT INTO auth_audit_logs (id, username, event_type, severity, ip_address, machine_id, details, timestamp)
           VALUES (?1, ?2, 'APPROVE', 'info', ?3, ?4, ?5, ?6)`
        )
          .bind(
            crypto.randomUUID(),
            user.tai_khoan,
            getIdentifierFromRequest(request).replace('ip:', ''),
            user.ma_may,
            JSON.stringify({ action: 'CHO_PHEP', key_kich_hoat: userWithKey?.key_kich_hoat || null }),
            Date.now()
          )
          .run()
      }
    } catch (err) {
      console.warn('[handleAdminUpdate] Failed to write audit log:', err)
    }

    // V2: Trả về key để admin copy (key đã có sẵn trong DB)
    const userWithKey = await env.DB.prepare('SELECT key_kich_hoat FROM registrations WHERE id = ?')
      .bind(id)
      .first<{ key_kich_hoat: string | null }>()

    return json({
      ok: true,
      key_kich_hoat: userWithKey?.key_kich_hoat || null,
      trang_thai: hanh_dong
    })
  } else {
    // CHAN - block account
    // FIX: Also revoke key_status and invalidate tokens
    await env.DB.prepare(
      `UPDATE registrations
       SET trang_thai = ?1,
           key_status = 'REVOKED',
           device_token = NULL, device_token_expires_at = NULL,
           refresh_token = NULL, refresh_token_expires_at = NULL
       WHERE id = ?2`
    )
      .bind(hanh_dong, id)
      .run()

    // V2: Ghi audit log
    try {
      const user = await env.DB.prepare('SELECT tai_khoan, ma_may FROM registrations WHERE id = ?')
        .bind(id)
        .first<{ tai_khoan: string; ma_may: string }>()

      if (user) {
        await env.DB.prepare(
          `INSERT INTO auth_audit_logs (id, username, event_type, severity, ip_address, machine_id, details, timestamp)
           VALUES (?1, ?2, 'BLOCK', 'warning', ?3, ?4, ?5, ?6)`
        )
          .bind(
            crypto.randomUUID(),
            user.tai_khoan,
            getIdentifierFromRequest(request).replace('ip:', ''),
            user.ma_may,
            JSON.stringify({ action: 'CHAN' }),
            Date.now()
          )
          .run()
      }
    } catch (err) {
      console.warn('[handleAdminUpdate] Failed to write audit log:', err)
    }

    return json({ ok: true, trang_thai: hanh_dong })
  }
}
