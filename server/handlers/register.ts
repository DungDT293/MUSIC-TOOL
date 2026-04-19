/**
 * POST /api/auth/register — Handle user registration
 */

import { json } from '../utils/json'
import type { Env } from '../env'
import { requireRateLimit, getIdentifierFromRequest, RateLimitPresets } from '../../backend/security/rateLimiter'

export async function handleRegister(request: Request, env: Env, parsedBody?: any): Promise<Response> {
  try {
    // SECURITY: Rate limiting - strict for registration (10 requests per minute)
    try {
      const identifier = getIdentifierFromRequest(request)
      requireRateLimit(identifier, RateLimitPresets.STRICT)
    } catch (err: any) {
      return json({ allow: false, reason: 'Quá nhiều yêu cầu đăng ký. Vui lòng đợi một chút.' }, 429)
    }

    if (!env.DB) {
      return json({ error: 'Database not available' }, 500)
    }

    // Use provided parsed body or parse from request
    const body = parsedBody !== undefined ? parsedBody : (await request.json().catch(() => null))
    const { tai_khoan, mat_khau, ma_may, version } = body || {}

    if (!tai_khoan || !mat_khau || !ma_may) {
      return json({ error: 'Thiếu tai_khoan / mat_khau / ma_may' }, 400)
    }

    const id = crypto.randomUUID()
    const now = Date.now()

    // Lưu mật khẩu plaintext (theo yêu cầu: không mã hóa mật khẩu user đã đặt)
    // V2: Tự động tạo key khi đăng ký (không trả về client)
    const keyKichHoat = crypto.randomUUID()

    // V2: Insert với key_status='PENDING' và key_kich_hoat đã được tạo
    // Try with V2 columns first, fallback to old schema if columns don't exist
    try {
      await env.DB.prepare(
        `INSERT INTO registrations (
          id, tai_khoan, mat_khau, ma_may, key_kich_hoat,
          key_status, key_attempts, trang_thai, thoi_gian_tao, version
        )
         VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', 0, 'CHO_DUYET', ?6, ?7)`
      )
        .bind(id, tai_khoan, mat_khau, ma_may, keyKichHoat, now, version || null)
        .run()
    } catch (dbErr: any) {
      const msg = String(dbErr?.message || dbErr)
      // Tài khoản đã tồn tại
      if (msg.includes('UNIQUE constraint failed') && msg.includes('tai_khoan')) {
        return json({ error: 'Tài khoản này đã được đăng ký. Vui lòng dùng tên khác hoặc đăng nhập.' }, 400)
      }
      // If columns don't exist, try with old schema
      if (msg.includes('no such column: key_status') || msg.includes('no such column: key_attempts')) {
        console.warn('[handleRegister] V2 columns not found, using old schema. Migration may be needed.')
        try {
          await env.DB.prepare(
            `INSERT INTO registrations (
              id, tai_khoan, mat_khau, ma_may, key_kich_hoat,
              trang_thai, thoi_gian_tao, version
            )
             VALUES (?1, ?2, ?3, ?4, ?5, 'CHO_DUYET', ?6, ?7)`
          )
            .bind(id, tai_khoan, mat_khau, ma_may, keyKichHoat, now, version || null)
            .run()
        } catch (fallbackErr: any) {
          const fm = String(fallbackErr?.message || fallbackErr)
          if (fm.includes('UNIQUE constraint failed') && fm.includes('tai_khoan')) {
            return json({ error: 'Tài khoản này đã được đăng ký. Vui lòng dùng tên khác hoặc đăng nhập.' }, 400)
          }
          throw fallbackErr
        }
      } else {
        throw dbErr
      }
    }

    // V2: Ghi audit log (bao gồm key_kich_hoat trong details)
    try {
      await env.DB.prepare(
        `INSERT INTO auth_audit_logs (id, username, event_type, severity, ip_address, machine_id, details, timestamp)
         VALUES (?1, ?2, 'REGISTER', 'info', ?3, ?4, ?5, ?6)`
      )
        .bind(
          crypto.randomUUID(),
          tai_khoan,
          getIdentifierFromRequest(request).replace('ip:', ''),
          ma_may,
          JSON.stringify({
            version: version || null,
            key_kich_hoat: keyKichHoat  // Lưu key vào audit log để hiển thị trong dashboard
          }),
          now
        )
        .run()
    } catch (err) {
      // Ignore audit log errors (table might not exist yet if migration not run)
      console.warn('[handleRegister] Failed to write audit log:', err)
    }

    // V2: KHÔNG trả key về client
    return json({
      status: 'pending',
      id,
      message: 'Yêu cầu đăng ký đã được ghi nhận, đang chờ admin cấp quyền.',
    })
  } catch (err: any) {
    console.error('[handleRegister] Error:', err)
    console.error('[handleRegister] Error stack:', err?.stack)
    const details = err?.message || String(err)
    // Thông báo thân thiện hơn tùy nguyên nhân
    let userMessage = 'Lỗi khi xử lý yêu cầu đăng ký'
    if (details.includes('no such table') || details.includes('no such column')) {
      userMessage = 'Cấu hình server chưa đúng (thiếu bảng/cột). Vui lòng liên hệ admin để chạy migration.'
    } else if (details.includes('Database not available') || details.includes('DB')) {
      userMessage = 'Server tạm thời không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.'
    }
    return json({
      error: userMessage,
    }, 500)
  }
}
