/// <reference path="./types.d.ts" />

/**
 * Example integration code cho server/index.ts
 * 
 * Copy các phần này vào server/index.ts của bạn
 */

import { verifyRequestSignature, cleanupOldNonces } from './security-verification'
import { checkAndAutoBlock } from './auto-block'
import { handleSecurityReport } from './security-report-endpoint'

interface Env {
  DB?: D1Database
  INSTALLER_SECRET?: string
  ADMIN_TOKEN?: string
  // ... other env vars
}

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    try {
      // ============================================
      // SECURITY: Verify signature cho tất cả routes
      // (trừ /api/security/report để tránh loop)
      // ============================================
      if (pathname !== '/api/security/report') {
        const body = await request.clone().json().catch(() => ({}))
        const verification = await verifyRequestSignature(request, body, env)
        
        if (!verification.valid) {
          // Report suspicious activity
          await handleSecurityReport(
            new Request(request.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'SIGNATURE_INVALID',
                severity: 'high',
                message: `Invalid signature: ${verification.error}`,
                machineId: request.headers.get('x-machine-id') || 'unknown',
                timestamp: Date.now(),
              }),
            }),
            env
          ).catch(() => {}) // Ignore errors khi report
          
          return json({ error: 'Invalid request signature' }, 401)
        }
      }

      // ============================================
      // EXISTING ROUTES
      // ============================================
      
      if (pathname === '/api/auth/register' && request.method === 'POST') {
        return handleRegister(request, env)
      }

      if (pathname === '/api/auth/check' && request.method === 'POST') {
        return handleCheck(request, env)
      }

      if (pathname === '/api/auth/admin/update' && request.method === 'POST') {
        return handleAdminUpdate(request, env)
      }

      // ============================================
      // SECURITY REPORT ENDPOINT
      // ============================================
      
      if (pathname === '/api/security/report' && request.method === 'POST') {
        return handleSecurityReport(request, env)
      }

      // ============================================
      // DASHBOARD API (nếu có)
      // ============================================
      
      if (pathname.startsWith('/api/admin/') && request.method === 'GET') {
        return handleDashboardAPI(request, env)
      }

      return json({ error: 'Not found' }, 404)
    } catch (err) {
      console.error('Worker error', err)
      return json({ error: 'Internal error' }, 500)
    }
  },
}

async function handleRegister(request: Request, env: Env) {
  const installerKey = request.headers.get('x-installer-key')
  if (!installerKey || installerKey !== env.INSTALLER_SECRET) {
    return json({ error: 'Installer key invalid' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  const { tai_khoan, mat_khau, ma_may } = body || {}

  if (!tai_khoan || !mat_khau || !ma_may) {
    return json({ error: 'Thiếu tai_khoan / mat_khau / ma_may' }, 400)
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  await env.DB.prepare(
    `INSERT INTO registrations (id, tai_khoan, mat_khau, ma_may, key_kich_hoat, trang_thai, thoi_gian_tao)
     VALUES (?1, ?2, ?3, ?4, NULL, 'CHO_DUYET', ?5)`
  )
    .bind(id, tai_khoan, mat_khau, ma_may, now)
    .run()

  return json({
    status: 'pending',
    id,
    message: 'Yêu cầu đăng ký đã được ghi nhận, đang chờ admin cấp quyền.',
  })
}

async function handleCheck(request: Request, env: Env) {
  const body = await request.json().catch(() => null)
  const { tai_khoan, mat_khau, ma_may } = body || {}

  if (!tai_khoan || !mat_khau || !ma_may) {
    return json({ error: 'Thiếu tai_khoan / mat_khau / ma_may' }, 400)
  }

  // ============================================
  // TRACK MACHINE ID
  // ============================================
  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }
  
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
  // CHECK MULTIPLE MACHINE IDs
  // ============================================
  const machineCount = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM machine_id_tracking WHERE username = ?'
  )
    .bind(tai_khoan)
    .first<{ count: number }>()

  if (machineCount && machineCount.count > 1) {
    // Report suspicious activity
    await handleSecurityReport(
      new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'MULTIPLE_MACHINE_IDS',
          severity: 'high',
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
      env
    ).catch(() => {})

    // Auto-block nếu > 3 machineIds
    if (machineCount.count > 3) {
      await env.DB.prepare(
        'UPDATE registrations SET trang_thai = ? WHERE tai_khoan = ?'
      )
        .bind('CHAN', tai_khoan)
        .run()

      return json({
        allow: false,
        reason: 'Tài khoản đã bị chặn do sử dụng quá nhiều máy.',
      })
    }
  }

  // ============================================
  // EXISTING CHECK LOGIC
  // ============================================
  const row = await env.DB.prepare(
    `SELECT id, tai_khoan, mat_khau, ma_may, key_kich_hoat, trang_thai
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
      trang_thai: string
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

  // CHO_PHEP
  if (row.mat_khau !== mat_khau) {
    return json({ allow: false, reason: 'Sai mật khẩu.' })
  }

  if (row.ma_may !== ma_may) {
    return json({
      allow: false,
      reason: 'Tài khoản này chỉ được phép dùng trên 1 máy.',
    })
  }

  return json({
    allow: true,
    key_kich_hoat: row.key_kich_hoat,
    trang_thai: row.trang_thai,
  })
}

async function handleAdminUpdate(request: Request, env: Env) {
  const adminToken = request.headers.get('x-admin-token')
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return json({ error: 'Admin token invalid' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  const { id, hanh_dong } = body || {} // 'CHO_PHEP' | 'CHAN'

  if (!id || !hanh_dong || !['CHO_PHEP', 'CHAN'].includes(hanh_dong)) {
    return json({ error: 'Thiếu id / hanh_dong hoặc hanh_dong không hợp lệ.' }, 400)
  }

  let key: string | null = null
  if (hanh_dong === 'CHO_PHEP') {
    key = crypto.randomUUID()
  }

  await env.DB.prepare(
    `UPDATE registrations
     SET trang_thai = ?1,
         key_kich_hoat = COALESCE(?2, key_kich_hoat)
     WHERE id = ?3`
  )
    .bind(hanh_dong, key, id)
    .run()

  return json({ ok: true, key_kich_hoat: key, trang_thai: hanh_dong })
}

async function handleDashboardAPI(request: Request, env: Env) {
  // Implementation trong dashboard-api.ts
  // Placeholder
  return json({ error: 'Not implemented' }, 501)
}

// Cleanup old nonces định kỳ (có thể chạy trong scheduled event)
// await cleanupOldNonces(env)

