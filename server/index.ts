/// <reference path="./types.d.ts" />

/**
 * Cloudflare Workers - License Server với Security Features
 * Main entry point cho Cloudflare Workers
 */

import { verifyRequestSignature, cleanupOldNonces } from './security-verification'
import { handleSecurityReport } from './security-report-endpoint'
import { handleDashboardAPI } from './dashboard-api'
import { handleMigration } from './migrations/migrate_v2'
import { generateToken, verifyToken, generateRefreshToken } from './utils/jwt'
import { requireRateLimit, getIdentifierFromRequest, RateLimitPresets } from '../backend/security/rateLimiter'
import { validatePayload } from '../backend/utils/validatePayload'
import {
  ServerRegisterSchema,
  ServerCheckSchema,
  ServerVideoExportSchema,
  ServerAdminUpdateSchema,
  ServerCheckStatusSchema,
  ServerValidateKeySchema,
  ServerValidateTokenSchema,
  ServerRefreshTokenSchema,
  ServerLoginSchema,
  VersionPolicySchema,
  ServerUpdateVersionPolicySchema,
} from '../shared/ipcSchemas'

// =========================
// Password Hashing (using Web Crypto API - compatible with Cloudflare Workers)
// =========================

/**
 * Hash password using PBKDF2 (Web Crypto API)
 * Compatible with Cloudflare Workers (no native modules)
 */
async function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  // Generate salt if not provided
  let saltBytes: Uint8Array
  if (!salt) {
    saltBytes = crypto.getRandomValues(new Uint8Array(16))
  } else {
    saltBytes = salt
  }
  
  // Import password as key material
  const encoder = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  
  // Derive key using PBKDF2
  // Create a new ArrayBuffer from Uint8Array to ensure type compatibility
  const saltBuffer = new ArrayBuffer(saltBytes.length)
  new Uint8Array(saltBuffer).set(saltBytes)
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000, // 100k iterations (strong)
      hash: 'SHA-256',
    },
    passwordKey,
    256 // 256 bits = 32 bytes
  )
  
  // Convert to base64 strings for storage
  const hash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
  const saltStr = btoa(String.fromCharCode(...saltBytes))
  
  return { hash, salt: saltStr }
}

/**
 * Verify password against stored hash
 */
async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  try {
    // Decode salt from base64
    const saltBytes = new Uint8Array(
      atob(storedSalt)
        .split('')
        .map(c => c.charCodeAt(0))
    )
    
    // Hash the provided password with the stored salt
    const { hash } = await hashPassword(password, saltBytes)
    
    // Compare hashes (constant-time comparison)
    if (hash.length !== storedHash.length) {
      return false
    }
    
    let result = 0
    for (let i = 0; i < hash.length; i++) {
      result |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i)
    }
    
    return result === 0
  } catch (err) {
    console.error('[verifyPassword] Error:', err)
    return false
  }
}

/**
 * Check if a password string is already hashed
 * Hashed passwords are stored as "hash:salt" format
 */
function isPasswordHashed(password: string): boolean {
  // Hashed passwords are stored as "hash:salt" format
  // hash = base64 of 32 bytes (PBKDF2-SHA256) = 44 chars
  // salt = base64 of 16 bytes = 24 chars
  // Total = 44 + 1 + 24 = 69 chars
  if (!password || password.length !== 69) return false

  const parts = password.split(':')
  if (parts.length !== 2) return false
  if (parts[0].length !== 44 || parts[1].length !== 24) return false

  // Verify both parts are valid base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/
  return base64Regex.test(parts[0]) && base64Regex.test(parts[1])
}

interface Env {
  // Database
  DB?: D1Database
  
  // Secrets
  INSTALLER_SECRET?: string
  ADMIN_TOKEN?: string
  JWT_SECRET?: string // V2: JWT signing secret
  
  // Email service (optional)
  SENDGRID_API_KEY?: string
  ALERT_EMAIL?: string
  
  // Webhook URL (optional)
  WEBHOOK_URL?: string
}

export function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * GET /api/version-policy
 * Get version policy (public, no auth required)
 */
async function handleVersionPolicy(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    // Check if version_policy table exists
    let tableExists = false
    try {
      const tableCheck = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='version_policy'"
      ).first<{ name: string }>()
      tableExists = !!tableCheck
    } catch (e) {
      tableExists = false
    }

    if (!tableExists) {
      // Return default policy if table doesn't exist
      const defaultPolicy = {
        latest_version: '3.6.0',
        min_supported_version: '3.6.0',
        blocked_versions: [],
        recommended_version: '3.6.0',
        recommended_installer_url: '',
        force_update: false,
        message: '',
        channel: 'stable',
      }
      return json(defaultPolicy)
    }

    const row = await env.DB.prepare(
      'SELECT policy_json FROM version_policy WHERE id = ?'
    )
      .bind('global')
      .first<{ policy_json: string }>()

    if (!row) {
      // Return default policy if not found
      const defaultPolicy = {
        latest_version: '3.6.0',
        min_supported_version: '3.6.0',
        blocked_versions: [],
        recommended_version: '3.6.0',
        recommended_installer_url: '',
        force_update: false,
        message: '',
        channel: 'stable',
      }
      return json(defaultPolicy)
    }

    // FIX: Validate JSON parse with error handling and schema validation
    let parsedPolicy: any
    try {
      parsedPolicy = JSON.parse(row.policy_json)
    } catch (parseErr: any) {
      console.error('[handleVersionPolicy] JSON parse error:', parseErr)
      console.warn('[handleVersionPolicy] policy_json is corrupted, returning default policy')
      // Return default policy if JSON is corrupted
      const defaultPolicy = {
        latest_version: '3.6.0',
        min_supported_version: '3.6.0',
        blocked_versions: [],
        recommended_version: '3.6.0',
        recommended_installer_url: '',
        force_update: false,
        message: '',
      }
      return json(defaultPolicy)
    }

    // FIX: Validate policy structure using Zod schema
    try {
      const validated = validatePayload(VersionPolicySchema, parsedPolicy)
      return json(validated)
    } catch (validationErr: any) {
      console.error('[handleVersionPolicy] Policy validation error:', validationErr)
      console.warn('[handleVersionPolicy] policy_json structure is invalid, returning default policy')
      // Return default policy if structure is invalid
      const defaultPolicy = {
        latest_version: '3.6.0',
        min_supported_version: '3.6.0',
        blocked_versions: [],
        recommended_version: '3.6.0',
        recommended_installer_url: '',
        force_update: false,
        message: '',
      }
      return json(defaultPolicy)
    }
  } catch (err: any) {
    console.error('[handleVersionPolicy] Error:', err)
    // Return default policy on error (fail-open)
    const defaultPolicy = {
      latest_version: '3.6.0',
      min_supported_version: '3.6.0',
      blocked_versions: [],
      recommended_version: '3.6.0',
      recommended_installer_url: '',
      force_update: false,
      message: '',
    }
    return json(defaultPolicy)
  }
}

/**
 * POST /api/admin/version-policy/update
 * Update version policy (admin only)
 */
async function handleUpdateVersionPolicy(request: Request, env: Env): Promise<Response> {
  // Support both x-admin-token header and Authorization Bearer token
  const adminToken = request.headers.get('x-admin-token') || 
                     request.headers.get('Authorization')?.replace('Bearer ', '')
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
    validated = validatePayload(ServerUpdateVersionPolicySchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { policy } = validated

  try {
    // Check if version_policy table exists, create if not
    let tableExists = false
    try {
      const tableCheck = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='version_policy'"
      ).first<{ name: string }>()
      tableExists = !!tableCheck
    } catch (e) {
      tableExists = false
    }

    if (!tableExists) {
      console.log('[handleUpdateVersionPolicy] Creating version_policy table...')
      // Create table
      await env.DB.prepare(`
        CREATE TABLE version_policy (
          id TEXT PRIMARY KEY DEFAULT 'global',
          policy_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run()
      
      // Create index
      await env.DB.prepare(`CREATE INDEX idx_version_policy_id ON version_policy(id)`).run()
      console.log('[handleUpdateVersionPolicy] Created version_policy table')
    }

    // Upsert policy
    await env.DB.prepare(
      `INSERT INTO version_policy (id, policy_json, updated_at)
       VALUES ('global', ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET
         policy_json = ?1,
         updated_at = ?2`
    )
      .bind(JSON.stringify(policy), Date.now())
      .run()

    return json({
      ok: true,
      message: 'Version policy updated successfully',
    })
  } catch (err: any) {
    console.error('[handleUpdateVersionPolicy] Error:', err)
    return json({
      error: 'Lỗi khi cập nhật version policy.',
    }, 500)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    try {
      // ============================================
      // SECURITY: Verify signature cho tất cả routes
      // (trừ /api/security/report, /dashboard, /, /api/auth/check, /api/video/export, /api/version-policy, /api/migrate/v2 để tránh loop và cho phép truy cập dashboard)
      // Dashboard API đã có Admin Token verification riêng
      // /api/auth/check không cần signature vì đã có authentication riêng (username/password)
      // /api/video/export không cần signature vì sẽ được gọi từ client app đã authenticated
      // /api/version-policy không cần signature vì là public endpoint (được gọi từ dashboard và client app)
      // /api/migrate/v2 không cần signature vì đã có Admin Token verification riêng
      // ============================================
      const publicRoutes = ['/api/security/report', '/dashboard', '/', '/api/auth/check', '/api/video/export', '/api/version-policy', '/api/migrate/v2']
      const isDashboardAPI = pathname.startsWith('/api/admin/')
      
      // Parse request body once for routes that need signature verification
      let parsedBody: any = null
      if (!publicRoutes.includes(pathname) && !isDashboardAPI) {
        parsedBody = await request.clone().json().catch(() => ({}))
        const verification = await verifyRequestSignature(request, parsedBody, env)
        
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
      // ROUTES
      // ============================================
      
      // Auth routes
      if (pathname === '/api/auth/register' && request.method === 'POST') {
        // Use parsed body if available, otherwise parse from request
        if (parsedBody === null) {
          parsedBody = await request.json().catch(() => null)
        }
        return handleRegister(request, env, parsedBody)
      }

      if (pathname === '/api/auth/check' && request.method === 'POST') {
        return handleCheck(request, env)
      }

      if (pathname === '/api/auth/admin/update' && request.method === 'POST') {
        return handleAdminUpdate(request, env)
      }

      // V2: New auth endpoints (import handlers dynamically)
      if (pathname === '/api/auth/check-status' && request.method === 'POST') {
        const { handleCheckStatus } = await import('./auth-v2-handlers')
        return handleCheckStatus(request, env)
      }

      if (pathname === '/api/auth/validate-key' && request.method === 'POST') {
        const { handleValidateKey } = await import('./auth-v2-handlers')
        return handleValidateKey(request, env)
      }

      if (pathname === '/api/auth/validate-token' && request.method === 'POST') {
        const { handleValidateToken } = await import('./auth-v2-handlers')
        return handleValidateToken(request, env)
      }

      if (pathname === '/api/auth/refresh-token' && request.method === 'POST') {
        const { handleRefreshToken } = await import('./auth-v2-handlers')
        return handleRefreshToken(request, env)
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        const { handleLogin } = await import('./auth-v2-handlers')
        return handleLogin(request, env)
      }

      // V2: Admin endpoints
      if (pathname === '/api/auth/admin/unlock-key' && request.method === 'POST') {
        const { handleUnlockKey } = await import('./auth-v2-handlers')
        return handleUnlockKey(request, env)
      }

      if (pathname === '/api/auth/admin/revoke-key' && request.method === 'POST') {
        const { handleRevokeKey } = await import('./auth-v2-handlers')
        return handleRevokeKey(request, env)
      }

      if (pathname === '/api/auth/admin/allow-rebind' && request.method === 'POST') {
        const { handleAllowRebind } = await import('./auth-v2-handlers')
        return handleAllowRebind(request, env)
      }

      // Version Policy endpoints (public, no auth required)
      if (pathname === '/api/version-policy' && request.method === 'GET') {
        return await handleVersionPolicy(request, env)
      }

      // Admin: Update version policy
      if (pathname === '/api/admin/version-policy/update' && request.method === 'POST') {
        return await handleUpdateVersionPolicy(request, env)
      }

      // Security report endpoint
      if (pathname === '/api/security/report' && request.method === 'POST') {
        return handleSecurityReport(request, env)
      }

      // Video export tracking endpoint
      if (pathname === '/api/video/export' && request.method === 'POST') {
        return handleVideoExport(request, env)
      }

      // Dashboard API (GET and POST)
      if (pathname.startsWith('/api/admin/') && (request.method === 'GET' || request.method === 'POST')) {
        return handleDashboardAPI(request, env)
      }

      // Migration endpoint (V2)
      if (pathname === '/api/migrate/v2' && request.method === 'POST') {
        return handleMigration(request, env)
      }

      // Dashboard HTML
      if (pathname === '/dashboard' || pathname === '/') {
        return serveDashboard()
      }

      return json({ error: 'Not found' }, 404)
    } catch (err: any) {
      console.error('Worker error', err)
      return json({ error: 'Internal error' }, 500)
    }
  },
}

/**
 * Handle registration request
 */
async function handleRegister(request: Request, env: Env, parsedBody?: any): Promise<Response> {
  try {
    // SECURITY: Rate limiting - strict for registration (10 requests per minute)
    try {
      const identifier = getIdentifierFromRequest(request)
      requireRateLimit(identifier, RateLimitPresets.STRICT)
    } catch (err: any) {
      return json({ allow: false, reason: 'Quá nhiều yêu cầu đăng ký. Vui lòng đợi một chút.' }, 429)
    }
    
    // Bỏ kiểm tra installer key - chưa cần thiết
    // const installerKey = request.headers.get('x-installer-key')
    // if (!installerKey || installerKey !== env.INSTALLER_SECRET) {
    //   return json({ error: 'Installer key invalid' }, 401)
    // }

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

/**
 * Handle check/login request
 */
async function handleCheck(request: Request, env: Env): Promise<Response> {
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

  // Update version nếu có
  if (version) {
    await env.DB.prepare(
      `UPDATE registrations SET version = ?1 WHERE tai_khoan = ?2`
    )
      .bind(version, tai_khoan)
      .run()
  }

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
      env
    ).catch(() => {})

    // Auto-block chỉ khi > 5 machineIds (nâng từ 3 lên 5 để tránh false positive
    // do VPN/driver changes gây machineId thay đổi)
    if (machineCount.count > 5) {
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
      'UPDATE registrations SET ma_may = ?1 WHERE tai_khoan = ?2'
    )
      .bind(normalizedRequestMachineId, tai_khoan)
      .run()
  }

  return json({
    allow: true,
    key_kich_hoat: row.key_kich_hoat,
    trang_thai: row.trang_thai,
  })
}

/**
 * Handle video export tracking request
 */
async function handleVideoExport(request: Request, env: Env): Promise<Response> {
  // SECURITY: Rate limiting - normal for video export tracking (60 requests per minute)
  try {
    const identifier = getIdentifierFromRequest(request)
    requireRateLimit(identifier, RateLimitPresets.NORMAL)
  } catch (err: any) {
    return json({ success: false, error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }, 429)
  }
  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  const body = await request.json().catch(() => null)
  
  // SECURITY: Validate payload
  let validated
  try {
    validated = validatePayload(ServerVideoExportSchema, body)
  } catch (err: any) {
    return json({ error: err.message || 'Dữ liệu không hợp lệ' }, 400)
  }
  
  const { username, machine_id, status, error_message, video_duration, file_size, export_format } = validated

  try {
    const timestamp = Date.now()
    
    await env.DB.prepare(
      `INSERT INTO video_exports (username, machine_id, status, error_message, video_duration, file_size, export_format, timestamp)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(
        username,
        machine_id,
        status,
        error_message || null,
        video_duration || null,
        file_size || null,
        export_format || null,
        timestamp
      )
      .run()

    return json({ ok: true, message: 'Video export tracked successfully' })
  } catch (error: any) {
    console.error('[Video Export] Error tracking export:', error)
    return json({ error: 'Failed to track video export' }, 500)
  }
}

/**
 * Handle admin update request
 */
async function handleAdminUpdate(request: Request, env: Env): Promise<Response> {
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
    await env.DB.prepare(
      `UPDATE registrations
       SET trang_thai = ?1
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
           VALUES (?1, ?2, 'APPROVE', 'warning', ?3, ?4, ?5, ?6)`
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

/**
 * Serve dashboard HTML
 */
function serveDashboard(): Response {
  // SECURITY: Content Security Policy for dashboard
  // Allow self, Chart.js CDN, and inline styles (dashboard uses inline styles)
  const cspPolicy = 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self' data: https://cdn.jsdelivr.net; " +
    "connect-src 'self'; " +
    "frame-src 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self';"

  // Dashboard HTML (inline template)
  const dashboardHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bảng Điều Khiển Bảo Mật - 93 Media Tool</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0; padding: 20px; min-height: 100vh; }
    .container { max-width: 1600px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #334155; }
    h1 { color: #f1f5f9; font-size: 28px; font-weight: 600; }
    .header-info { color: #94a3b8; font-size: 14px; }
    .controls { display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap; background: #1e293b; padding: 15px; border-radius: 8px; border: 1px solid #334155; }
    .controls select, .controls input { padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 14px; transition: all 0.2s; }
    .controls select:focus, .controls input:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }
    .controls button { padding: 10px 20px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; }
    .controls button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); }
    .controls button:active { transform: translateY(0); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 24px; position: relative; overflow: hidden; transition: all 0.3s; }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #0ea5e9, #0284c7); }
    .stat-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); border-color: #0ea5e9; }
    .stat-card h3 { font-size: 13px; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
    .stat-card .value { font-size: 36px; font-weight: 700; line-height: 1; margin-bottom: 8px; }
    .stat-card .label { font-size: 12px; color: #64748b; }
    .stat-card.total .value { color: #0ea5e9; }
    .stat-card.critical .value { color: #ef4444; }
    .stat-card.high .value { color: #f97316; }
    .stat-card.medium .value { color: #eab308; }
    .stat-card.low .value { color: #22c55e; }
    .chart-container { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 30px; }
    .chart-container h2 { margin-bottom: 24px; font-size: 18px; font-weight: 600; color: #f1f5f9; }
    .events-table { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; overflow: hidden; }
    .events-table table { width: 100%; border-collapse: collapse; }
    .events-table th { background: #0f172a; padding: 14px 16px; text-align: left; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; border-bottom: 2px solid #334155; }
    .events-table td { padding: 14px 16px; border-bottom: 1px solid #334155; font-size: 14px; }
    .events-table tr:hover { background: rgba(14, 165, 233, 0.05); }
    .events-table tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-critical { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-high { background: rgba(249, 115, 22, 0.2); color: #f97316; border: 1px solid rgba(249, 115, 22, 0.3); }
    .badge-medium { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .badge-low { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
    .loading { text-align: center; padding: 60px 20px; color: #94a3b8; font-size: 14px; }
    .loading::before { content: '⏳ '; }
    .error { background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); border: 1px solid #dc2626; border-radius: 8px; padding: 16px; margin-bottom: 20px; color: #fca5a5; display: flex; align-items: center; gap: 12px; }
    .error::before { content: '⚠️ '; font-size: 20px; }
    .auth-form { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 40px; max-width: 420px; margin: 80px auto; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); }
    .auth-form h2 { margin-bottom: 24px; color: #f1f5f9; font-size: 24px; text-align: center; }
    .auth-form input { width: 100%; padding: 12px 16px; margin: 10px 0; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 14px; transition: all 0.2s; }
    .auth-form input:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }
    .auth-form button { width: 100%; padding: 14px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 16px; font-weight: 600; margin-top: 16px; transition: all 0.2s; }
    .auth-form button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(14, 165, 233, 0.4); }
    .hidden { display: none; }
    code { background: rgba(14, 165, 233, 0.1); padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 12px; color: #0ea5e9; }
    .empty-state { text-align: center; padding: 60px 20px; color: #64748b; }
    .empty-state::before { content: '📊 '; font-size: 48px; display: block; margin-bottom: 16px; }
    .tabs { display: flex; gap: 10px; margin-bottom: 30px; border-bottom: 2px solid #334155; }
    .tab { padding: 12px 24px; background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; font-weight: 500; border-bottom: 3px solid transparent; transition: all 0.2s; }
    .tab:hover { color: #e2e8f0; }
    .tab.active { color: #0ea5e9; border-bottom-color: #0ea5e9; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .status-cho_duyet { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .status-cho_phep { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
    .status-chan { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .action-btn { padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; margin: 0 2px; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; min-width: 70px; white-space: nowrap; }
    .btn-approve { background: #22c55e; color: white; }
    .btn-approve:hover { background: #16a34a; }
    .btn-block { background: #ef4444; color: white; }
    .btn-block:hover { background: #dc2626; }
    .btn-unblock { background: #0ea5e9; color: white; }
    .btn-unblock:hover { background: #0284c7; }
    .btn-edit { background: #6366f1; color: white; }
    .btn-edit:hover { background: #4f46e5; }
    .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 1000; align-items: center; justify-content: center; }
    .modal.active { display: flex; }
    .modal-content { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 30px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .modal-header h2 { color: #f1f5f9; font-size: 20px; }
    .modal-close { background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; }
    .modal-close:hover { color: #e2e8f0; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; color: #94a3b8; font-size: 14px; margin-bottom: 8px; font-weight: 500; }
    .form-group input, .form-group select { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 14px; }
    .form-group input:focus, .form-group select:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }
    .form-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
    .form-actions button { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-cancel { background: #64748b; color: white; }
    .btn-cancel:hover { background: #475569; }
    .btn-save { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: white; }
    .btn-save:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); }
    .json-viewer { background: #0f172a; padding: 16px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 12px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .machines-list { max-height: 300px; overflow-y: auto; }
    .machine-item { padding: 10px; background: #0f172a; border-radius: 6px; margin-bottom: 8px; border: 1px solid #334155; }
    .machine-item code { display: block; margin-bottom: 6px; color: #0ea5e9; }
    .machine-item .info { font-size: 12px; color: #94a3b8; }
    .clickable { cursor: pointer; color: #0ea5e9; }
    .clickable:hover { text-decoration: underline; }
    .icon-btn { padding: 8px 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer; }
    .icon-btn:hover { border-color: #0ea5e9; }
    .field-row { display: flex; gap: 8px; align-items: center; }
    .field-text { color: #e2e8f0; word-break: break-word; }
  </style>
</head>
<body>
  <div id="authForm" class="auth-form">
    <h2>🔐 Xác Thực Quản Trị</h2>
    <div class="field-row" style="gap: 8px; margin: 10px 0;">
      <input type="password" id="tokenInput" placeholder="Nhập Admin Token" autocomplete="off" style="flex: 1;">
      <button type="button" id="tokenToggleBtn" class="icon-btn" onclick="toggleTokenVisibility()" title="Hiện/ẩn token" style="padding: 12px 14px;">👁️</button>
    </div>
    <button id="loginButton">Đăng Nhập</button>
    <p class="auth-hint" style="margin-top: 12px; font-size: 12px; color: #64748b;">Quên Admin Token? Set lại bằng: <code>wrangler secret put ADMIN_TOKEN</code> (xem <code>server/set-admin-token.bat</code>)</p>
    <div id="authError" class="error hidden" style="margin-top: 16px;"></div>
  </div>
  <div id="dashboard" class="container hidden">
    <div class="header">
      <h1>🔒 Bảng Điều Khiển Bảo Mật</h1>
      <div class="header-info">Cập nhật lần cuối: <span id="lastUpdate">-</span></div>
    </div>
    <div class="tabs">
      <button class="tab active" onclick="switchTab('events')">📊 Sự Kiện Bảo Mật</button>
      <button class="tab" onclick="switchTab('auditLogs')">🔐 Audit Logs</button>
      <button class="tab" onclick="switchTab('users')">👥 Quản Lý Người Dùng</button>
      <button class="tab" onclick="switchTab('top')">🏆 Top Người Dùng & Máy</button>
      <button class="tab" onclick="switchTab('activity')">📝 Lịch Sử Hoạt Động</button>
      <button class="tab" onclick="switchTab('licenses')">🔑 Quản Lý License</button>
      <button class="tab" onclick="switchTab('versionPolicy')">📦 Quản Lý Phiên Bản</button>
      <button class="tab" onclick="switchTab('settings')">⚙️ Cài Đặt</button>
      <button class="tab" onclick="showAutoBlockRules()" style="margin-left: auto;">🛡️ Quy Tắc Tự Động Chặn</button>
    </div>
    <div id="eventsTab" class="tab-content active">
    <div class="controls">
      <select id="severityFilter">
        <option value="">Tất cả Mức Độ</option>
        <option value="critical">Nghiêm Trọng</option>
        <option value="high">Cao</option>
        <option value="medium">Trung Bình</option>
        <option value="low">Thấp</option>
      </select>
      <select id="eventTypeFilter">
        <option value="">Tất cả Loại Sự Kiện</option>
      </select>
      <input type="number" id="hoursFilter" value="24" min="1" max="168" placeholder="Giờ">
      <button onclick="refreshData()">🔄 Làm Mới</button>
      <button onclick="autoRefresh()">⏱️ Tự Động: <span id="autoRefreshStatus">TẮT</span></button>
      <button onclick="exportEvents('csv')" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">📥 Xuất CSV</button>
      <button onclick="exportEvents('json')" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">📥 Xuất JSON</button>
    </div>
    <div id="errorContainer"></div>
    <div class="stats-grid">
      <div class="stat-card total">
        <h3>📊 Tổng Sự Kiện</h3>
        <div class="value" id="totalEvents">-</div>
        <div class="label" id="totalEventsLabel">trong 24 giờ qua</div>
      </div>
      <div class="stat-card critical">
        <h3>🔴 Nghiêm Trọng</h3>
        <div class="value" id="criticalCount">-</div>
        <div class="label">cần xử lý ngay</div>
      </div>
      <div class="stat-card high">
        <h3>🟠 Cao</h3>
        <div class="value" id="highCount">-</div>
        <div class="label">ưu tiên xử lý</div>
      </div>
      <div class="stat-card medium">
        <h3>🟡 Trung Bình</h3>
        <div class="value" id="mediumCount">-</div>
        <div class="label">theo dõi</div>
      </div>
      <div class="stat-card low">
        <h3>🟢 Thấp</h3>
        <div class="value" id="lowCount">-</div>
        <div class="label">thông tin</div>
      </div>
    </div>
    <div class="chart-container">
      <h2>📈 Phân Tích Theo Loại Sự Kiện</h2>
      <canvas id="typeChart" style="max-height: 300px;"></canvas>
    </div>
    <div class="chart-container">
      <h2>🥧 Phân Tích Theo Mức Độ</h2>
      <canvas id="severityChart" style="max-height: 300px;"></canvas>
    </div>
    <div class="chart-container">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0;">📊 Xu Hướng Theo Thời Gian</h2>
        <div style="display: flex; gap: 10px; align-items: center;">
          <select id="timelineGroupBy" onchange="loadTimeline()" style="padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 12px;">
            <option value="hour">Theo Giờ</option>
            <option value="day" selected>Theo Ngày</option>
            <option value="week">Theo Tuần</option>
          </select>
        </div>
      </div>
      <div id="timelineTrend" style="margin-bottom: 15px; padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid #334155;">
        <div style="display: flex; gap: 20px; align-items: center;">
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Xu Hướng</div>
            <div id="timelineTrendValue" style="font-size: 18px; font-weight: 600; color: #0ea5e9;">-</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Kỳ Hiện Tại</div>
            <div id="timelineCurrentCount" style="font-size: 18px; font-weight: 600; color: #22c55e;">-</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Kỳ Trước</div>
            <div id="timelinePreviousCount" style="font-size: 18px; font-weight: 600; color: #64748b;">-</div>
          </div>
        </div>
      </div>
      <canvas id="timelineChart" style="max-height: 400px;"></canvas>
    </div>
    <div class="events-table">
      <table>
        <thead>
          <tr>
            <th>Thời Gian</th>
            <th>Loại Sự Kiện</th>
            <th>Mức Độ</th>
            <th>Thông Điệp</th>
            <th>Mã Máy</th>
            <th>Người Dùng</th>
            <th>Phiên Bản</th>
            <th>Chi Tiết</th>
          </tr>
        </thead>
        <tbody id="eventsTableBody">
          <tr><td colspan="6" class="loading">Đang tải dữ liệu...</td></tr>
        </tbody>
      </table>
    </div>
    </div>
    <div id="usersTab" class="tab-content">
      <div class="controls">
        <input type="text" id="userSearchInput" placeholder="🔍 Tìm kiếm (tài khoản, mã máy)..." style="flex: 1; min-width: 200px;">
        <select id="userStatusFilter">
          <option value="">Tất cả Trạng Thái</option>
          <option value="CHO_DUYET">Chờ Duyệt</option>
          <option value="CHO_PHEP">Đã Cho Phép</option>
          <option value="CHAN">Đã Chặn</option>
        </select>
        <button onclick="loadUsers()">🔄 Làm Mới</button>
        <button onclick="exportUsers('csv')" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">📥 Xuất CSV</button>
        <button onclick="exportUsers('json')" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">📥 Xuất JSON</button>
      </div>
      <div id="bulkActionsBar" style="display: none; background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #334155;">
        <span id="selectedCount" style="color: #0ea5e9; font-weight: 600; margin-right: 15px;">0 đã chọn</span>
        <button onclick="bulkUpdateUsers('CHO_PHEP')" class="action-btn btn-approve" style="margin: 0 5px;">✅ Duyệt Hàng Loạt</button>
        <button onclick="bulkUpdateUsers('CHAN')" class="action-btn btn-block" style="margin: 0 5px;">🚫 Chặn Hàng Loạt</button>
        <button onclick="bulkUpdateUsers('CHO_DUYET')" class="action-btn" style="background: #eab308; color: white; margin: 0 5px;">⏸️ Về Chờ Duyệt</button>
        <button onclick="clearSelection()" style="background: #64748b; color: white; padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; margin-left: 10px;">✖️ Bỏ Chọn</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
          <tr>
            <th style="width: 40px;"><input type="checkbox" id="selectAllUsers" onchange="toggleSelectAll()"></th>
            <th>Tài Khoản</th>
            <th>Mật Khẩu</th>
            <th>Mã Máy</th>
            <th>Trạng Thái</th>
            <th>Số Máy</th>
            <th>Key Kích Hoạt</th>
            <th>Trạng Thái Key</th>
            <th>Hoạt Động Cuối</th>
            <th style="width: 100px; text-align: center;">Phiên Bản</th>
            <th style="width: 150px; text-align: center;">Thao Tác</th>
          </tr>
          </thead>
          <tbody id="usersTableBody">
            <tr><td colspan="9" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="usersPagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding: 15px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 14px;">
          <span id="usersPaginationInfo">Hiển thị 0-0 / 0</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="changeUsersPage(-1)" id="usersPrevBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">◀ Trước</button>
          <span id="usersPageNumbers" style="display: flex; gap: 5px; align-items: center;"></span>
          <button onclick="changeUsersPage(1)" id="usersNextBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">Sau ▶</button>
        </div>
        <select id="usersPageSize" onchange="loadUsers()" style="padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;">
          <option value="10">10 / trang</option>
          <option value="25" selected>25 / trang</option>
          <option value="50">50 / trang</option>
          <option value="100">100 / trang</option>
        </select>
      </div>
    </div>
    <div id="topTab" class="tab-content">
      <div class="controls">
        <input type="number" id="topHoursFilter" value="24" min="1" max="168" placeholder="Giờ">
        <button onclick="loadTopData()">🔄 Làm Mới</button>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div class="chart-container">
          <h2>🔝 Top Máy Có Nhiều Sự Kiện</h2>
          <div id="topMachinesList" class="loading">Đang tải...</div>
        </div>
        <div class="chart-container">
          <h2>🔝 Top Người Dùng Có Nhiều Sự Kiện</h2>
          <div id="topUsernamesList" class="loading">Đang tải...</div>
        </div>
      </div>
      <div class="chart-container" style="margin-top: 20px;">
        <h2>⏱️ Top Máy Có Thời Gian Sử Dụng App Nhiều Nhất</h2>
        <div id="topMachinesByUsageList" class="loading">Đang tải...</div>
      </div>
      <div class="chart-container" style="margin-top: 20px;">
        <h2>🎬 Top Người Dùng Xuất Video Nhiều Nhất</h2>
        <div id="topUsersVideoExportsList" class="loading">Đang tải...</div>
      </div>
    </div>
    <div id="activityTab" class="tab-content">
      <div class="controls">
        <select id="activityActionFilter">
          <option value="">Tất cả Hành Động</option>
          <option value="approve">Duyệt</option>
          <option value="block">Chặn</option>
          <option value="unblock">Bỏ Chặn</option>
          <option value="edit">Chỉnh Sửa</option>
          <option value="bulk_approve">Duyệt Hàng Loạt</option>
          <option value="bulk_block">Chặn Hàng Loạt</option>
          <option value="bulk_unblock">Bỏ Chặn Hàng Loạt</option>
          <option value="revoke_key">Thu Hồi Key</option>
          <option value="regenerate_key">Tạo Lại Key</option>
        </select>
        <select id="activityTargetFilter">
          <option value="">Tất cả Đối Tượng</option>
          <option value="user">Người Dùng</option>
          <option value="license">License</option>
          <option value="system">Hệ Thống</option>
        </select>
        <input type="number" id="activityHoursFilter" value="24" min="1" max="168" placeholder="Giờ">
        <button onclick="loadActivityLog()">🔄 Làm Mới</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Thời Gian</th>
              <th>Hành Động</th>
              <th>Đối Tượng</th>
              <th>Tên</th>
              <th>Giá Trị Cũ</th>
              <th>Giá Trị Mới</th>
              <th>IP Admin</th>
            </tr>
          </thead>
          <tbody id="activityTableBody">
            <tr><td colspan="7" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="auditLogsTab" class="tab-content">
      <div class="controls">
        <select id="auditEventTypeFilter">
          <option value="">Tất cả Loại</option>
          <option value="REGISTER">Đăng Ký</option>
          <option value="APPROVE">Duyệt</option>
          <option value="KEY_VALIDATE">Xác Thực Key</option>
          <option value="KEY_FAIL">Key Sai</option>
          <option value="KEY_LOCK">Key Bị Khóa</option>
          <option value="KEY_UNLOCK">Mở Khóa Key</option>
          <option value="KEY_REVOKE">Thu Hồi Key</option>
          <option value="LOGIN">Đăng Nhập</option>
          <option value="LOGOUT">Đăng Xuất</option>
          <option value="TAMPER">Tamper Detection</option>
          <option value="MACHINE_REBIND">Đổi Máy</option>
        </select>
        <select id="auditSeverityFilter">
          <option value="">Tất cả Mức Độ</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>
        <input type="text" id="auditUsernameFilter" placeholder="🔍 Username..." style="flex: 1; min-width: 150px;">
        <input type="text" id="auditMachineIdFilter" placeholder="🔍 Machine ID..." style="flex: 1; min-width: 150px;">
        <input type="number" id="auditHoursFilter" value="24" min="1" max="168" placeholder="Giờ">
        <button onclick="loadAuditLogs()">🔄 Làm Mới</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Thời Gian</th>
              <th>Username</th>
              <th>Loại Sự Kiện</th>
              <th>Mức Độ</th>
              <th>IP Address</th>
              <th>Machine ID</th>
              <th>Key Kích Hoạt</th>
              <th>Chi Tiết</th>
            </tr>
          </thead>
          <tbody id="auditLogsTableBody">
            <tr><td colspan="8" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="auditLogsPagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding: 15px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 14px;">
          <span id="auditLogsPaginationInfo">Hiển thị 0-0 / 0</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="changeAuditLogsPage(-1)" id="auditLogsPrevBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">◀ Trước</button>
          <span id="auditLogsPageNumbers" style="display: flex; gap: 5px; align-items: center;"></span>
          <button onclick="changeAuditLogsPage(1)" id="auditLogsNextBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">Sau ▶</button>
        </div>
        <select id="auditLogsPageSize" onchange="loadAuditLogs()" style="padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;">
          <option value="25" selected>25 / trang</option>
          <option value="50">50 / trang</option>
          <option value="100">100 / trang</option>
        </select>
      </div>
    </div>
    <div id="licensesTab" class="tab-content">
      <div class="controls">
        <input type="text" id="licenseSearchInput" placeholder="🔍 Tìm kiếm (key, username)..." style="flex: 1; min-width: 200px;">
        <button onclick="loadLicenses()">🔄 Làm Mới</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Key Kích Hoạt</th>
            <th>Trạng Thái Key</th>
              <th>Người Dùng</th>
              <th>Mật Khẩu</th>
              <th>Mã Máy</th>
              <th>Trạng Thái</th>
              <th>Ngày Tạo</th>
              <th>Thao Tác</th>
            </tr>
          </thead>
          <tbody id="licensesTableBody">
            <tr><td colspan="7" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="settingsTab" class="tab-content">
      <div class="chart-container">
        <h2>🔑 Admin Token (mở lại khi quên)</h2>
        <p style="color: #94a3b8; font-size: 13px; margin-bottom: 12px;">Token đang dùng để đăng nhập dashboard. Dùng khi cần copy lại hoặc kiểm tra.</p>
        <div class="field-row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
          <input type="password" id="settingsTokenInput" readonly style="flex: 1; min-width: 200px;" value="">
          <button type="button" class="icon-btn" id="settingsTokenToggleBtn" onclick="toggleSettingsTokenVisibility()" title="Hiện/ẩn token">👁️</button>
          <button type="button" class="action-btn btn-approve" onclick="copySettingsToken()">📋 Copy</button>
        </div>
        <p style="font-size: 12px; color: #64748b; margin-top: 8px;">Token được lưu trong trình duyệt (localStorage). Khi đăng xuất hoặc xóa cookie/storage sẽ mất — set lại bằng <code>wrangler secret put ADMIN_TOKEN</code>.</p>
      </div>
      <div class="chart-container">
        <h2>📧 Cấu Hình Email Alerts</h2>
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
            <input type="checkbox" id="emailAlertsEnabled" onchange="saveAlertSettings()">
            <span>Bật Email Alerts</span>
          </label>
          <div class="form-group">
            <label>Email Nhận Cảnh Báo</label>
            <input type="email" id="alertEmail" placeholder="your-email@example.com" onchange="saveAlertSettings()">
          </div>
          <div class="form-group">
            <label>Ngưỡng Cảnh Báo (số events)</label>
            <input type="number" id="alertThreshold" value="10" min="1" onchange="saveAlertSettings()">
          </div>
          <div class="form-group">
            <label>Tần Suất Cảnh Báo</label>
            <select id="alertFrequency" onchange="saveAlertSettings()">
              <option value="realtime">Real-time</option>
              <option value="hourly">Mỗi Giờ</option>
              <option value="daily" selected>Hàng Ngày</option>
            </select>
          </div>
        </div>
      </div>
      <div class="chart-container">
        <h2>🔔 Cấu Hình Webhook Alerts</h2>
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
            <input type="checkbox" id="webhookAlertsEnabled" onchange="saveAlertSettings()">
            <span>Bật Webhook Alerts</span>
          </label>
          <div class="form-group">
            <label>Webhook URL (Discord/Slack)</label>
            <input type="url" id="webhookUrl" placeholder="https://discord.com/api/webhooks/..." onchange="saveAlertSettings()">
          </div>
        </div>
      </div>
      <div class="chart-container">
        <h2>🎯 Cấu Hình Alert Cho Từng Loại Event</h2>
        <div id="eventTypeAlerts" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">
          <!-- Will be populated by JavaScript -->
        </div>
      </div>
    </div>
    <div id="versionPolicyTab" class="tab-content">
      <div class="controls">
        <button onclick="loadVersionPolicy()">🔄 Làm Mới</button>
        <button onclick="saveVersionPolicy()" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">💾 Lưu Cấu Hình</button>
      </div>
      <div id="versionPolicyError" class="error hidden" style="margin-bottom: 20px;"></div>
      <div class="chart-container">
        <h2>📦 Cấu Hình Phiên Bản (Version Policy)</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div class="form-group">
            <label>Phiên Bản Stable Mới Nhất</label>
            <input type="text" id="policyLatestVersion" placeholder="3.6.0" pattern="^\\d+\\.\\d+\\.\\d+$">
            <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Format: x.y.z (ví dụ: 3.6.0)</div>
          </div>
          <div class="form-group">
            <label>Phiên Bản Tối Thiểu Hỗ Trợ</label>
            <input type="text" id="policyMinSupportedVersion" placeholder="3.6.0" pattern="^\\d+\\.\\d+\\.\\d+$">
          </div>
        </div>
        <div class="form-group">
          <label>Phiên Bản Đề Xuất</label>
          <input type="text" id="policyRecommendedVersion" placeholder="3.6.0" pattern="^\\d+\\.\\d+\\.\\d+$">
        </div>
        <div class="form-group">
          <label>URL Installer Đề Xuất (Optional)</label>
          <input type="url" id="policyRecommendedInstallerUrl" placeholder="https://license-updates.pages.dev/win/93 Media - Tool Mix Nhạc-Setup-3.6.0.exe" style="width: 100%;">
        </div>
        <div class="form-group">
          <label>Phiên Bản Bị Chặn (Blocked Versions)</label>
          <textarea id="policyBlockedVersions" placeholder="3.5.0, 3.5.1" style="width: 100%; min-height: 80px; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-family: monospace; font-size: 13px;"></textarea>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Nhập các version bị chặn, cách nhau bởi dấu phẩy (ví dụ: 3.5.0, 3.5.1)</div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
          <input type="checkbox" id="policyForceUpdate">
          <label for="policyForceUpdate" style="margin: 0; cursor: pointer;">🔒 Force Update (Bắt buộc cập nhật cho version cũ)</label>
        </div>
        <div class="form-group">
          <label>Thông Điệp (Optional)</label>
          <textarea id="policyMessage" placeholder="Thông điệp hiển thị cho user..." style="width: 100%; min-height: 60px; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;"></textarea>
        </div>
      </div>
      <div class="chart-container" style="margin-top: 20px;">
        <h2>🧪 Cấu Hình Beta Channel</h2>
        <div class="form-group">
          <label>Phiên Bản Beta Mới Nhất</label>
          <input type="text" id="policyBetaLatestVersion" placeholder="3.7.0-beta.1" pattern="^\\d+\\.\\d+\\.\\d+(-beta\\.\\d+)?$">
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Format: x.y.z-beta.n (ví dụ: 3.7.0-beta.1) hoặc để trống nếu không có beta</div>
        </div>
        <div class="form-group">
          <label>URL Beta Updates (Optional)</label>
          <input type="url" id="policyBetaUpdateUrl" placeholder="https://license-updates.pages.dev/beta/win/" style="width: 100%;">
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Mặc định: https://license-updates.pages.dev/beta/win/</div>
        </div>
        <div class="form-group">
          <label>Phiên Bản Beta Bị Chặn (Beta Blocked Versions)</label>
          <textarea id="policyBetaBlockedVersions" placeholder="3.7.0-beta.1" style="width: 100%; min-height: 60px; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-family: monospace; font-size: 13px;"></textarea>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Nhập các beta version bị chặn, cách nhau bởi dấu phẩy</div>
        </div>
      </div>
      <div class="chart-container" style="margin-top: 20px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155;">
        <h2>📋 Xem Trước Policy Hiện Tại</h2>
        <div id="versionPolicyPreview" class="json-viewer" style="max-height: 300px; overflow-y: auto;">Đang tải...</div>
      </div>
    </div>
    <div id="keyModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🔑 Key Kích Hoạt</h2>
          <button class="modal-close" onclick="closeKeyModal()">&times;</button>
        </div>
        <div class="form-group">
          <label>Key đã được tạo cho người dùng:</label>
          <div class="field-row">
            <code id="keyModalKey" class="field-text" style="flex: 1; font-size: 14px; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #0ea5e9; word-break: break-all;">-</code>
            <button type="button" class="icon-btn" onclick="copyKeyModal()" style="padding: 12px 16px; font-size: 14px;">📋 Copy</button>
          </div>
        </div>
        <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
          <div style="color: #94a3b8; font-size: 13px; margin-bottom: 8px;">💡 Hướng dẫn:</div>
          <div style="color: #e2e8f0; font-size: 12px; line-height: 1.6;">
            Copy key này và gửi cho người dùng. Họ sẽ cần nhập key này vào app để kích hoạt tài khoản.
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-save" onclick="closeKeyModal()">Đóng</button>
        </div>
      </div>
    </div>
    <div id="editModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>✏️ Chỉnh Sửa Người Dùng</h2>
          <button class="modal-close" onclick="closeEditModal()">&times;</button>
        </div>
        <form id="editUserForm" onsubmit="saveUserEdit(event)">
          <input type="hidden" id="editUserId">
          <div class="form-group">
            <label>Tài Khoản</label>
            <input type="text" id="editTaiKhoan" required>
          </div>
          <div class="form-group">
            <label>Mật Khẩu</label>
            <input type="password" id="editMatKhau" placeholder="Để trống nếu không đổi">
          </div>
          <div class="form-group">
            <label>Mã Máy</label>
            <input type="text" id="editMaMay" required>
          </div>
          <div class="form-group">
            <label>Trạng Thái</label>
            <select id="editTrangThai" required style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #f1f5f9;">
              <option value="CHO_DUYET">Chờ Duyệt</option>
              <option value="CHO_PHEP">Đã Cho Phép</option>
              <option value="CHAN">Đã Chặn</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-cancel" onclick="closeEditModal()">Hủy</button>
            <button type="submit" class="btn-save">💾 Lưu</button>
          </div>
        </form>
      </div>
    </div>
    <div id="userDetailModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>👁️ Chi Tiết Người Dùng</h2>
          <button class="modal-close" onclick="closeUserDetailModal()">&times;</button>
        </div>
        <div class="form-group">
          <label>Tài Khoản</label>
          <div id="detailTaiKhoan" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Mã Máy</label>
          <div class="field-row">
            <code id="detailMaMay" class="field-text" style="flex: 1;">-</code>
            <button type="button" class="icon-btn" onclick="copyDetailMachine()">Copy</button>
          </div>
        </div>
        <div class="form-group">
          <label>Key Kích Hoạt</label>
          <div class="field-row">
            <code id="detailKey" class="field-text" style="flex: 1;">-</code>
            <button type="button" class="icon-btn" onclick="copyDetailKey()">Copy</button>
          </div>
        </div>
        <div class="form-group">
          <label>Mật Khẩu</label>
          <div class="field-row">
            <input type="password" id="detailMatKhau" readonly style="flex: 1; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;">
            <button type="button" class="icon-btn" onclick="togglePasswordVisibility('detailMatKhau', this)">👁️</button>
            <button type="button" class="icon-btn" onclick="copyDetailPassword()">Copy</button>
          </div>
          <div id="detailMatKhauHint" style="font-size: 12px; color: #94a3b8; margin-top: 6px; display: none;"></div>
        </div>
        <div class="form-group">
          <label>Trạng Thái</label>
          <div id="detailTrangThai" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Phiên Bản</label>
          <div id="detailVersion" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Ngày Tạo</label>
          <div id="detailCreated" class="field-text">-</div>
        </div>
      </div>
    </div>
    <div id="eventDetailsModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>📋 Chi Tiết Sự Kiện</h2>
          <button class="modal-close" onclick="closeEventDetailsModal()">&times;</button>
        </div>
        <div id="eventDetailsContent" class="json-viewer"></div>
      </div>
    </div>
    <div id="userMachinesModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🖥️ Máy Của Người Dùng</h2>
          <button class="modal-close" onclick="closeUserMachinesModal()">&times;</button>
        </div>
        <div id="userMachinesContent" class="machines-list"></div>
      </div>
    </div>
    <div id="autoBlockRulesModal" class="modal">
      <div class="modal-content" style="max-width: 700px;">
        <div class="modal-header">
          <h2>🛡️ Quy Tắc Tự Động Chặn</h2>
          <button class="modal-close" onclick="closeAutoBlockRulesModal()">&times;</button>
        </div>
        <div id="autoBlockRulesContent"></div>
      </div>
    </div>
  </div>
  <script>
    const API_BASE = window.location.origin
    let ADMIN_TOKEN = localStorage.getItem('admin_token') || ''
    let typeChart = null, severityChart = null, timelineChart = null, autoRefreshInterval = null
    let currentDetailUser = null
    
    // Format số với dấu phẩy
    function formatNumber(num) {
      return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
    }

    // Escape HTML entities để chống XSS
    function escapeHtml(str) {
      if (!str) return ''
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }
    
    // Format thời gian tiếng Việt
    function formatDateTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)
      
      if (minutes < 1) return 'Vừa xong'
      if (minutes < 60) return \`\${minutes} phút trước\`
      if (hours < 24) return \`\${hours} giờ trước\`
      if (days < 7) return \`\${days} ngày trước\`
      
      return date.toLocaleString('vi-VN', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      })
    }
    
    // Dịch loại sự kiện
    const eventTypeLabels = {
      'SIGNATURE_INVALID': 'Chữ Ký Không Hợp Lệ',
      'SIGNATURE_REPLAY': 'Chữ Ký Lặp Lại',
      'NONCE_REUSED': 'Nonce Đã Sử Dụng',
      'LICENSE_CHECK_FAILED': 'Kiểm Tra License Thất Bại',
      'TAMPERING_DETECTED': 'Phát Hiện Can Thiệp',
      'ANTI_DEBUG_TRIGGERED': 'Phát Hiện Debug',
      'MACHINE_ID_MISMATCH': 'Mã Máy Không Khớp',
      'ENCRYPTION_DECRYPTION_FAILED': 'Mã Hóa/Giải Mã Lỗi',
      'FILE_INTEGRITY_FAILED': 'Tính Toàn Vẹn File Lỗi',
      'RATE_LIMIT_EXCEEDED': 'Vượt Giới Hạn Tần Suất',
      'MULTIPLE_MACHINE_IDS': 'Nhiều Mã Máy',
      'TEST_DEPLOY': 'Test Deploy'
    }
    
    // Dịch mức độ
    const severityLabels = {
      'critical': 'Nghiêm Trọng',
      'high': 'Cao',
      'medium': 'Trung Bình',
      'low': 'Thấp'
    }
    
    // Dịch trạng thái user
    const statusLabels = {
      'CHO_DUYET': 'Chờ Duyệt',
      'CHO_PHEP': 'Đã Cho Phép',
      'CHAN': 'Đã Chặn'
    }
    
    // Switch tabs
    // Audit Logs pagination
    let currentAuditLogsPage = 1
    let currentAuditLogsPageSize = 25
    let currentAuditLogsTotal = 0
    
    function updateAuditLogsPagination() {
      const totalPages = Math.ceil(currentAuditLogsTotal / currentAuditLogsPageSize)
      const start = (currentAuditLogsPage - 1) * currentAuditLogsPageSize + 1
      const end = Math.min(currentAuditLogsPage * currentAuditLogsPageSize, currentAuditLogsTotal)
      document.getElementById('auditLogsPaginationInfo').textContent = \`Hiển thị \${start}-\${end} / \${currentAuditLogsTotal}\`
      
      document.getElementById('auditLogsPrevBtn').disabled = currentAuditLogsPage === 1
      document.getElementById('auditLogsNextBtn').disabled = currentAuditLogsPage >= totalPages
      
      const pageNumbers = document.getElementById('auditLogsPageNumbers')
      pageNumbers.innerHTML = ''
      
      const maxPages = 5
      let startPage = Math.max(1, currentAuditLogsPage - Math.floor(maxPages / 2))
      let endPage = Math.min(totalPages, startPage + maxPages - 1)
      if (endPage - startPage < maxPages - 1) {
        startPage = Math.max(1, endPage - maxPages + 1)
      }
      
      for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button')
        btn.textContent = i
        btn.style.padding = '8px 12px'
        btn.style.background = i === currentAuditLogsPage ? '#0ea5e9' : '#0f172a'
        btn.style.border = '1px solid #334155'
        btn.style.borderRadius = '6px'
        btn.style.color = '#e2e8f0'
        btn.style.cursor = 'pointer'
        btn.onclick = () => { currentAuditLogsPage = i; loadAuditLogs() }
        pageNumbers.appendChild(btn)
      }
    }
    
    function changeAuditLogsPage(delta) {
      const totalPages = Math.ceil(currentAuditLogsTotal / currentAuditLogsPageSize)
      const newPage = currentAuditLogsPage + delta
      if (newPage >= 1 && newPage <= totalPages) {
        currentAuditLogsPage = newPage
        loadAuditLogs()
      }
    }
    
    // Load audit logs
    async function loadAuditLogs() {
      try {
        const eventType = document.getElementById('auditEventTypeFilter').value
        const severity = document.getElementById('auditSeverityFilter').value
        const username = document.getElementById('auditUsernameFilter').value.trim()
        const machineId = document.getElementById('auditMachineIdFilter').value.trim()
        const hours = parseInt(document.getElementById('auditHoursFilter')?.value || '24') || 24
        currentAuditLogsPageSize = parseInt(document.getElementById('auditLogsPageSize').value) || 25
        const offset = (currentAuditLogsPage - 1) * currentAuditLogsPageSize
        
        const params = new URLSearchParams({
          hours: hours.toString(),
          limit: currentAuditLogsPageSize.toString(),
          offset: offset.toString()
        })
        if (eventType) params.append('eventType', eventType)
        if (severity) params.append('severity', severity)
        if (username) params.append('username', username)
        if (machineId) params.append('machineId', machineId)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/audit-logs?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('auditLogsTableBody')
        if (!result.logs || result.logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Không có audit log nào</td></tr>'
          currentAuditLogsTotal = 0
          updateAuditLogsPagination()
          return
        }
        
        currentAuditLogsTotal = result.total || 0
        updateAuditLogsPagination()
        
        const eventTypeLabels = {
          'REGISTER': '📝 Đăng Ký',
          'APPROVE': '✅ Duyệt',
          'KEY_VALIDATE': '🔑 Xác Thực Key',
          'KEY_FAIL': '❌ Key Sai',
          'KEY_LOCK': '🔒 Key Bị Khóa',
          'KEY_UNLOCK': '🔓 Mở Khóa Key',
          'KEY_REVOKE': '🚫 Thu Hồi Key',
          'LOGIN': '🔐 Đăng Nhập',
          'LOGOUT': '🚪 Đăng Xuất',
          'TAMPER': '⚠️ Tamper Detection',
          'MACHINE_REBIND': '🔄 Đổi Máy'
        }
        
        const severityLabels = {
          'info': 'ℹ️ Info',
          'warning': '⚠️ Warning',
          'error': '❌ Error',
          'critical': '🚨 Critical'
        }
        
        tbody.innerHTML = result.logs.map(log => {
          const eventTypeText = eventTypeLabels[log.event_type] || escapeHtml(log.event_type)
          const severityText = severityLabels[log.severity] || escapeHtml(log.severity)
          const severityClass = \`badge-\${escapeHtml(log.severity)}\`
          const details = log.details ? JSON.parse(log.details) : null
          const detailsStr = details ? escapeHtml(JSON.stringify(details, null, 2).substring(0, 200)) : '-'

          // Extract key from details if available (for REGISTER and APPROVE events)
          let keyDisplay = '-'
          if (details && details.key_kich_hoat) {
            const key = escapeHtml(details.key_kich_hoat)
            keyDisplay = \`<code style="font-size: 12px; color: #22c55e; cursor: pointer; padding: 4px 8px; background: rgba(34, 197, 94, 0.1); border-radius: 4px; font-weight: 600; font-family: monospace;" onclick="copyTextSafely('\${key}', 'Key')" title="Click để copy">\${key}</code>\`
          }

          return \`
            <tr>
              <td>\${formatDateTime(log.timestamp)}</td>
              <td><strong>\${escapeHtml(log.username)}</strong></td>
              <td>\${eventTypeText}</td>
              <td><span class="badge \${severityClass}">\${severityText}</span></td>
              <td><code style="font-size: 11px;">\${escapeHtml(log.ip_address) || '-'}</code></td>
              <td><code style="font-size: 11px;">\${log.machine_id ? escapeHtml(log.machine_id.substring(0, 24)) + '...' : '-'}</code></td>
              <td>\${keyDisplay}</td>
              <td>
                <code style="font-size: 11px; white-space: pre-wrap; max-width: 300px; overflow: hidden; text-overflow: ellipsis; color: #94a3b8;" title="\${detailsStr}">\${detailsStr}</code>
              </td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
      event.target.classList.add('active')
      if (tabName === 'events') {
        document.getElementById('eventsTab').classList.add('active')
      } else if (tabName === 'users') {
        document.getElementById('usersTab').classList.add('active')
        loadUsers()
      } else if (tabName === 'top') {
        document.getElementById('topTab').classList.add('active')
        loadTopData()
      } else if (tabName === 'activity') {
        document.getElementById('activityTab').classList.add('active')
        loadActivityLog()
      } else if (tabName === 'auditLogs') {
        document.getElementById('auditLogsTab').classList.add('active')
        currentAuditLogsPage = 1
        loadAuditLogs()
      } else if (tabName === 'licenses') {
        document.getElementById('licensesTab').classList.add('active')
        loadLicenses()
      } else if (tabName === 'settings') {
        document.getElementById('settingsTab').classList.add('active')
        loadSettingsTokenDisplay()
        loadAlertSettings()
      } else if (tabName === 'versionPolicy') {
        document.getElementById('versionPolicyTab').classList.add('active')
        loadVersionPolicy()
      }
    }
    
    // Load top machines and usernames
    async function loadTopData() {
      try {
        const hours = parseInt(document.getElementById('topHoursFilter')?.value || '24') || 24
        
        // Load top machines
        const machinesResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-machines?hours=\${hours}&limit=10\`)
        if (machinesResult.ok) {
          const machinesList = document.getElementById('topMachinesList')
          if (machinesResult.machines.length === 0) {
            machinesList.innerHTML = '<div class="empty-state">Không có dữ liệu</div>'
          } else {
            machinesList.innerHTML = \`
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 1px solid #334155;">
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #94a3b8;">Mã Máy</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #94a3b8;">Sự Kiện</th>
                    <th style="padding: 8px; text-align: center; font-size: 12px; color: #94a3b8;">Mức Độ</th>
                  </tr>
                </thead>
                <tbody>
                  \${machinesResult.machines.map((m, idx) => \`
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px;"><code style="font-size: 11px;">\${m.machine_id.substring(0, 20)}...</code></td>
                      <td style="padding: 10px; text-align: right; font-weight: 600; color: #0ea5e9;">\${formatNumber(m.event_count)}</td>
                      <td style="padding: 10px; text-align: center;"><span class="badge badge-\${m.max_severity}">\${severityLabels[m.max_severity] || m.max_severity}</span></td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            \`
          }
        }
        
        // Load top usernames
        const usernamesResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-usernames?hours=\${hours}&limit=10\`)
        if (usernamesResult.ok) {
          const usernamesList = document.getElementById('topUsernamesList')
          if (usernamesResult.usernames.length === 0) {
            usernamesList.innerHTML = '<div class="empty-state">Không có dữ liệu</div>'
          } else {
            usernamesList.innerHTML = \`
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 1px solid #334155;">
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #94a3b8;">Người Dùng</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #94a3b8;">Sự Kiện</th>
                    <th style="padding: 8px; text-align: center; font-size: 12px; color: #94a3b8;">Mức Độ</th>
                  </tr>
                </thead>
                <tbody>
                  \${usernamesResult.usernames.map((u, idx) => \`
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px;"><strong>\${u.username}</strong></td>
                      <td style="padding: 10px; text-align: right; font-weight: 600; color: #0ea5e9;">\${formatNumber(u.event_count)}</td>
                      <td style="padding: 10px; text-align: center;"><span class="badge badge-\${u.max_severity}">\${severityLabels[u.max_severity] || u.max_severity}</span></td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            \`
          }
        }
        
        // Load top machines by usage
        const usageResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-machines-by-usage?limit=10\`)
        if (usageResult.ok) {
          const usageList = document.getElementById('topMachinesByUsageList')
          if (usageResult.machines.length === 0) {
            usageList.innerHTML = '<div class="empty-state">Không có dữ liệu</div>'
          } else {
            usageList.innerHTML = \`
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 1px solid #334155;">
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #94a3b8;">Mã Máy</th>
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #94a3b8;">Người Dùng</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #94a3b8;">Số Lần Truy Cập</th>
                    <th style="padding: 8px; text-align: center; font-size: 12px; color: #94a3b8;">Thời Gian Hoạt Động</th>
                    <th style="padding: 8px; text-align: center; font-size: 12px; color: #94a3b8;">Lần Cuối</th>
                  </tr>
                </thead>
                <tbody>
                  \${usageResult.machines.map((m, idx) => {
                    const activeDays = Math.floor(m.active_duration_ms / (1000 * 60 * 60 * 24))
                    const activeHours = Math.floor((m.active_duration_ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
                    const activeMinutes = Math.floor((m.active_duration_ms % (1000 * 60 * 60)) / (1000 * 60))
                    let activeDuration = ''
                    if (activeDays > 0) activeDuration += \`\${activeDays} ngày \`
                    if (activeHours > 0) activeDuration += \`\${activeHours} giờ \`
                    if (activeMinutes > 0 || activeDuration === '') activeDuration += \`\${activeMinutes} phút\`
                    return \`
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px;"><code style="font-size: 11px;">\${m.machine_id.substring(0, 24)}...</code></td>
                      <td style="padding: 10px;"><strong>\${m.username || '-'}</strong></td>
                      <td style="padding: 10px; text-align: right; font-weight: 600; color: #0ea5e9;">\${formatNumber(m.request_count)}</td>
                      <td style="padding: 10px; text-align: center; color: #94a3b8; font-size: 12px;">\${activeDuration.trim()}</td>
                      <td style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">\${formatDateTime(m.last_seen)}</td>
                    </tr>
                  \`
                  }).join('')}
                </tbody>
              </table>
            \`
          }
        }
        
        // Load top users video exports
        const videoExportsResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-users-video-exports?limit=10\`)
        if (videoExportsResult.ok) {
          const videoExportsList = document.getElementById('topUsersVideoExportsList')
          if (videoExportsResult.users.length === 0) {
            videoExportsList.innerHTML = '<div class="empty-state">Chưa có dữ liệu xuất video</div>'
          } else {
            videoExportsList.innerHTML = \`
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 1px solid #334155;">
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #94a3b8;">Người Dùng</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #94a3b8;">Tổng Video</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #94a3b8;">Thành Công</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #94a3b8;">Thất Bại</th>
                    <th style="padding: 8px; text-align: center; font-size: 12px; color: #94a3b8;">Lần Cuối</th>
                  </tr>
                </thead>
                <tbody>
                  \${videoExportsResult.users.map((u, idx) => \`
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px;"><strong>\${u.username}</strong></td>
                      <td style="padding: 10px; text-align: right; font-weight: 600; color: #0ea5e9;">\${formatNumber(u.total_exports)}</td>
                      <td style="padding: 10px; text-align: right; font-weight: 600; color: #22c55e;">✓ \${formatNumber(u.success_count)}</td>
                      <td style="padding: 10px; text-align: right; font-weight: 600; color: #ef4444;">✗ \${formatNumber(u.failed_count)}</td>
                      <td style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">\${u.last_export_time ? formatDateTime(u.last_export_time) : '-'}</td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            \`
          }
        }
      } catch (error) {
        console.error('Error loading top data:', error)
        document.getElementById('topMachinesList').innerHTML = '<div class="error">Lỗi tải dữ liệu</div>'
        document.getElementById('topUsernamesList').innerHTML = '<div class="error">Lỗi tải dữ liệu</div>'
        document.getElementById('topMachinesByUsageList').innerHTML = '<div class="error">Lỗi tải dữ liệu</div>'
        if (document.getElementById('topUsersVideoExportsList')) {
          document.getElementById('topUsersVideoExportsList').innerHTML = '<div class="error">Lỗi tải dữ liệu</div>'
        }
      }
    }
    
    // Load users
    async function loadUsers() {
      try {
        const status = document.getElementById('userStatusFilter').value
        const params = new URLSearchParams({ limit: '100' })
        if (status) params.append('status', status)

        const response = await fetch(\`\${API_BASE}/api/admin/users?\${params}\`, {
          headers: { 
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) {
          console.error('API error:', result.error)
          throw new Error(result.error || 'Lỗi không xác định')
        }
        
        const tbody = document.getElementById('usersTableBody')
        if (!tbody) {
          console.error('usersTableBody element not found')
          return
        }
        
        if (!result.users || result.users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Không tìm thấy người dùng nào</td></tr>'
          return
        }

        const renderedHTML = result.users.map((user, index) => {
          try {
            const safeTaiKhoan = escapeHtml(user.tai_khoan)
            const safeMaMay = escapeHtml(user.ma_may)
            const safeVersion = escapeHtml(user.version)
            const statusClass = \`status-\${escapeHtml(user.trang_thai.toLowerCase())}\`
            const statusText = statusLabels[user.trang_thai] || escapeHtml(user.trang_thai)
            const lastActive = user.last_active ? formatDateTime(user.last_active) : 'Chưa có'
            const machineIdCell = user.ma_may
              ? \`<span class="clickable" title="Xem chi tiết" onclick="openUserDetail('\${user.id}')"><code>\${safeMaMay.substring(0, 24)}...</code></span>\`
              : '<span style="color: #64748b;">-</span>'
            const activationKey = user.key_kich_hoat
              ? \`<span class="clickable" title="Xem chi tiết key" onclick="openUserDetail('\${user.id}')"><code style="font-size: 11px;">\${escapeHtml(user.key_kich_hoat.substring(0, 20))}...</code></span>\`
              : '<span style="color: #64748b;">-</span>'
            const machineCount = user.machine_count || 0
            const multipleMachinesWarning = machineCount > 1 ? \`<span style="color: #f97316; font-size: 12px; cursor: pointer;" onclick="showUserMachines('\${safeTaiKhoan}')" title="⚠️ Click để xem chi tiết \${machineCount} máy">⚠️ \${machineCount}</span>\` : (machineCount > 0 ? \`<span style="cursor: pointer;" onclick="showUserMachines('\${safeTaiKhoan}')" title="Click để xem chi tiết">\${machineCount}</span>\` : '0')
            
            // Password cell with eye icon - escape HTML attributes
            const passwordId = \`pwd-user-\${user.id}\`
            const realPassword = (user.mat_khau || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            const maskedPassword = realPassword ? realPassword.replace(/./g, '*') : '-'
            const disabledAttr = !realPassword ? 'disabled' : ''
            const disabledStyle = !realPassword ? 'opacity: 0.5; cursor: not-allowed;' : ''
            
            const passwordCell = \`
              <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                <input 
                  type="password" 
                  id="\${passwordId}" 
                  value="\${maskedPassword}" 
                  readonly 
                  style="flex: 1; padding: 6px 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 12px; font-family: monospace; min-width: 100px; max-width: 200px;"
                  data-real-password="\${realPassword}"
                />
                <button 
                  type="button" 
                  class="icon-btn" 
                  onclick="toggleTablePasswordVisibility('\${passwordId}', this)"
                  style="padding: 6px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; cursor: pointer; font-size: 16px; min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; \${disabledStyle}"
                  onmouseover="if(!this.disabled) this.style.background='#2563eb'"
                  onmouseout="if(!this.disabled) this.style.background='#1e293b'"
                  title="Hiện/Ẩn mật khẩu"
                  \${disabledAttr}
                >👁️</button>
              </div>
            \`
            
          
          // V2: Get key_status
          const keyStatus = user.key_status || 'PENDING'
          const keyStatusLabels = {
            'PENDING': '⏳ Chờ',
            'ACTIVE': '✅ Hoạt động',
            'LOCKED': '🔒 Đã khóa',
            'REVOKED': '🚫 Đã thu hồi'
          }
          const keyStatusText = keyStatusLabels[keyStatus] || keyStatus
          
          let actions = \`<div style="display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap;">\`
          actions += \`<button class="action-btn btn-edit" onclick="openEditModal('\${user.id}')" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">✏️ Sửa</button>\`
          if (user.trang_thai === 'CHO_DUYET') {
            actions += \`<button class="action-btn btn-approve" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">✅ Duyệt</button>
                       <button class="action-btn btn-block" onclick="updateUserStatus('\${user.id}', 'CHAN')" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">🚫 Chặn</button>\`
          } else if (user.trang_thai === 'CHO_PHEP') {
            actions += \`<button class="action-btn btn-block" onclick="updateUserStatus('\${user.id}', 'CHAN')" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">🚫 Chặn</button>\`
            // V2: Key management actions
            if (keyStatus === 'LOCKED') {
              actions += \`<button class="action-btn btn-unlock" onclick="unlockKey('\${safeTaiKhoan}')" title="Mở khóa key" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">🔓 Mở khóa</button>\`
            }
            if (keyStatus === 'ACTIVE' || keyStatus === 'LOCKED') {
              actions += \`<button class="action-btn btn-revoke" onclick="revokeKey('\${safeTaiKhoan}')" title="Thu hồi key" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">🔑 Thu hồi</button>\`
            }
            actions += \`<button class="action-btn btn-rebind" onclick="allowRebind('\${safeTaiKhoan}')" title="Cho phép đổi máy" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">🔄 Đổi máy</button>\`
          } else if (user.trang_thai === 'CHAN') {
            actions += \`<button class="action-btn btn-unblock" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">🔓 Bỏ Chặn</button>\`
          }
          actions += \`</div>\`
          
            
            const versionDisplay = user.version && user.version !== '-'
              ? \`<span style="display: inline-block; padding: 4px 10px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: white; border-radius: 6px; font-size: 12px; font-weight: 600; font-family: monospace; box-shadow: 0 2px 4px rgba(14, 165, 233, 0.3);">\${safeVersion}</span>\`
              : \`<span style="color: #64748b; font-size: 12px;">-</span>\`
            
            return \`
              <tr>
                <td><strong>\${safeTaiKhoan}</strong></td>
                <td>\${passwordCell}</td>
                <td>\${machineIdCell}</td>
                <td><span class="status-badge \${statusClass}">\${statusText}</span></td>
                <td>\${multipleMachinesWarning}</td>
                <td>\${activationKey}</td>
                <td><span class="status-badge" style="font-size: 11px;">\${keyStatusText}</span></td>
                <td>\${lastActive}</td>
                <td style="text-align: center; vertical-align: middle;">\${versionDisplay}</td>
                <td style="text-align: center; vertical-align: middle;">\${actions}</td>
              </tr>
            \`
          } catch (err) {
            console.error('Error rendering user:', user.id, err)
            return \`<tr><td colspan="9" style="color: red;">Lỗi render user \${user.id}</td></tr>\`
          }
        }).join('')
        
        
        tbody.innerHTML = renderedHTML
      } catch (error) {
        console.error('Error in loadUsers:', error)
        const tbody = document.getElementById('usersTableBody')
        if (tbody) {
          tbody.innerHTML = \`<tr><td colspan="9" class="empty-state" style="color: red;">Lỗi: \${error.message || 'Không thể tải dữ liệu'}</td></tr>\`
        }
        showError(error.message || 'Không thể tải danh sách người dùng')
      }
    }
    
    // Show key modal when approve user
    function showKeyModal(key) {
      document.getElementById('keyModalKey').textContent = key || '-'
      document.getElementById('keyModal').classList.add('active')
    }
    
    function closeKeyModal() {
      document.getElementById('keyModal').classList.remove('active')
    }
    
    function copyKeyModal() {
      const key = document.getElementById('keyModalKey').textContent
      copyTextSafely(key, 'Key kích hoạt')
    }
    
    // Update user status
    async function updateUserStatus(userId, status) {
      if (!confirm(\`Bạn chắc chắn muốn thay đổi trạng thái người dùng?\`)) return
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/users/\${userId}/update\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          },
          body: JSON.stringify({ status })
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) {
          const errorMsg = result.error || result.message || 'Cập nhật thất bại'
          console.error('Update status failed:', errorMsg, result)
          throw new Error(errorMsg)
        }
        
        // V2: Nếu approve thành công và có key, hiển thị modal với key để copy
        if (status === 'CHO_PHEP' && result.key_kich_hoat) {
          showKeyModal(result.key_kich_hoat)
        } else {
          alert('Cập nhật thành công!')
        }
        
        // Clear filter to show all users (including the one we just updated)
        document.getElementById('userStatusFilter').value = ''
        
        // Force reload users list
        await loadUsers()
      } catch (error) {
        console.error('Error updating user status:', error)
        showError(error.message)
      }
    }
    
    // Open edit modal
    async function openEditModal(userId) {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${userId}\`)
        if (!result.ok) throw new Error(result.error || 'Không thể tải thông tin user')
        
        const user = result.user
        document.getElementById('editUserId').value = user.id
        document.getElementById('editTaiKhoan').value = user.tai_khoan || ''
        document.getElementById('editMatKhau').value = ''
        document.getElementById('editMaMay').value = user.ma_may || ''
        
        // Set dropdown value - ensure it's one of the valid options
        const trangThaiSelect = document.getElementById('editTrangThai')
        const validStatuses = ['CHO_DUYET', 'CHO_PHEP', 'CHAN']
        const userStatus = user.trang_thai || 'CHO_DUYET'
        
        if (validStatuses.includes(userStatus)) {
          trangThaiSelect.value = userStatus
        } else {
          // Fallback to first option if invalid
          trangThaiSelect.value = 'CHO_DUYET'
          console.warn('Invalid status:', userStatus, 'using default CHO_DUYET')
        }
        
        // Ensure dropdown is enabled
        trangThaiSelect.disabled = false
        
        document.getElementById('editModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Close edit modal
    function closeEditModal() {
      document.getElementById('editModal').classList.remove('active')
      document.getElementById('editUserForm').reset()
    }
    
    // Hiện/ẩn Admin Token (form đăng nhập dashboard)
    function toggleTokenVisibility() {
      const input = document.getElementById('tokenInput')
      const btn = document.getElementById('tokenToggleBtn')
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      if (btn) btn.textContent = isHidden ? '🙈' : '👁️'
    }
    
    // Tab Cài đặt: điền token vào ô "Admin Token (mở lại khi quên)"
    function loadSettingsTokenDisplay() {
      const si = document.getElementById('settingsTokenInput')
      if (si) { si.value = ADMIN_TOKEN || localStorage.getItem('admin_token') || ''; si.type = 'password' }
      const stb = document.getElementById('settingsTokenToggleBtn')
      if (stb) stb.textContent = '👁️'
    }
    function toggleSettingsTokenVisibility() {
      const input = document.getElementById('settingsTokenInput')
      const btn = document.getElementById('settingsTokenToggleBtn')
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      if (btn) btn.textContent = isHidden ? '🙈' : '👁️'
    }
    function copySettingsToken() {
      const input = document.getElementById('settingsTokenInput')
      if (!input || !input.value) { alert('Không có token để copy'); return }
      navigator.clipboard.writeText(input.value).then(function() { alert('Đã copy token vào clipboard'); }).catch(function() { alert('Không copy được'); })
    }
    
    // Toggle password visibility helpers
    function togglePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId)
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      if (btn) btn.textContent = isHidden ? '🙈' : '👁️'
    }
    
    // Toggle password visibility in table
    function toggleTablePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId)
      if (!input || input.disabled) return
      const realPassword = input.getAttribute('data-real-password') || ''
      if (!realPassword || realPassword === '-') return
      
      const isHidden = input.type === 'password'
      
      if (isHidden) {
        // Show real password
        input.type = 'text'
        input.value = realPassword
        if (btn) btn.textContent = '🙈'
      } else {
        // Hide password with asterisks
        input.type = 'password'
        input.value = realPassword.replace(/./g, '*')
        if (btn) btn.textContent = '👁️'
      }
    }

    // User detail modal
    async function openUserDetail(userId) {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${userId}\`)
        if (!result.ok) throw new Error(result.error || 'Không thể tải chi tiết user')
        const user = result.user
        currentDetailUser = user
        document.getElementById('detailTaiKhoan').textContent = user.tai_khoan || '-'
        document.getElementById('detailMaMay').textContent = user.ma_may || '-'
        document.getElementById('detailKey').textContent = user.key_kich_hoat || '-'
        const pwd = document.getElementById('detailMatKhau')
        pwd.value = user.mat_khau || ''
        pwd.type = 'password'
        const hintEl = document.getElementById('detailMatKhauHint')
        if (hintEl) {
          const val = user.mat_khau || ''
          if (val.indexOf(':') >= 0 && val.length > 20) {
            hintEl.style.display = 'block'
            hintEl.textContent = 'Mật khẩu đang lưu dạng hash (tài khoản cũ). Dùng "Chỉnh sửa" → nhập mật khẩu mới → Lưu để lưu plaintext và xem được.'
          } else {
            hintEl.style.display = 'none'
            hintEl.textContent = ''
          }
        }
        document.getElementById('detailTrangThai').textContent = statusLabels[user.trang_thai] || user.trang_thai || '-'
        document.getElementById('detailVersion').textContent = user.version || '-'
        document.getElementById('detailCreated').textContent = user.thoi_gian_tao ? new Date(user.thoi_gian_tao).toLocaleString('vi-VN') : '-'
        document.getElementById('userDetailModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }

    function closeUserDetailModal() {
      document.getElementById('userDetailModal').classList.remove('active')
      currentDetailUser = null
      const pwd = document.getElementById('detailMatKhau')
      if (pwd) pwd.type = 'password'
    }

    async function copyTextSafely(text, label) {
      try {
        await navigator.clipboard.writeText(text || '')
        alert(\`\${label} đã được copy\`)
      } catch {
        alert('Không copy được')
      }
    }

    function copyDetailMachine() {
      if (!currentDetailUser) return
      copyTextSafely(currentDetailUser.ma_may || '', 'Mã máy')
    }

    function copyDetailKey() {
      if (!currentDetailUser) return
      copyTextSafely(currentDetailUser.key_kich_hoat || '', 'Key')
    }

    function copyDetailPassword() {
      if (!currentDetailUser) return
      copyTextSafely(currentDetailUser.mat_khau || '', 'Mật khẩu')
    }

    // V2: Unlock key
    async function unlockKey(taiKhoan) {
      if (!confirm(\`Bạn chắc chắn muốn mở khóa key cho tài khoản "\${taiKhoan}"?\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/auth/admin/unlock-key\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ tai_khoan: taiKhoan })
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Mở khóa key thất bại')
        alert('Mở khóa key thành công!')
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // V2: Revoke key
    async function revokeKey(taiKhoan) {
      if (!confirm(\`Bạn chắc chắn muốn thu hồi key cho tài khoản "\${taiKhoan}"? Tất cả tokens sẽ bị vô hiệu hóa.\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/auth/admin/revoke-key\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ tai_khoan: taiKhoan })
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Thu hồi key thất bại')
        alert('Thu hồi key thành công! Tất cả tokens đã bị vô hiệu hóa.')
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // V2: Allow rebind
    async function allowRebind(taiKhoan) {
      const newMachineId = prompt(\`Nhập machineId mới cho tài khoản "\${taiKhoan}":\`)
      if (!newMachineId || !newMachineId.trim()) return
      
      if (!confirm(\`Bạn chắc chắn muốn cho phép đổi machineId cho tài khoản "\${taiKhoan}"?\n\nMachineId mới: \${newMachineId}\n\nTất cả tokens cũ sẽ bị vô hiệu hóa.\`)) return
      
      try {
        const response = await fetch(\`\${API_BASE}/api/auth/admin/allow-rebind\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ 
            tai_khoan: taiKhoan,
            new_machine_id: newMachineId.trim()
          })
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Cho phép đổi machineId thất bại')
        alert('Đã cho phép đổi machineId thành công! User cần đăng nhập lại với machineId mới.')
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // Save user edit
    async function saveUserEdit(event) {
      event.preventDefault()
      
      const userId = document.getElementById('editUserId').value
      const taiKhoan = document.getElementById('editTaiKhoan').value.trim()
      const matKhau = document.getElementById('editMatKhau').value.trim()
      const maMay = document.getElementById('editMaMay').value.trim()
      const trangThaiSelect = document.getElementById('editTrangThai')
      const trangThai = trangThaiSelect.value
      
      // Validate required fields
      if (!taiKhoan || !maMay) {
        alert('Vui lòng điền đầy đủ thông tin!')
        return
      }
      
      // Validate status
      const validStatuses = ['CHO_DUYET', 'CHO_PHEP', 'CHAN']
      if (!trangThai || !validStatuses.includes(trangThai)) {
        alert('Trạng thái không hợp lệ!')
        return
      }
      
      try {
        const body = {
          tai_khoan: taiKhoan,
          ma_may: maMay,
          trang_thai: trangThai
        }
        
        // Only include password if provided
        if (matKhau) {
          body.mat_khau = matKhau
        }

        const response = await fetch(\`\${API_BASE}/api/admin/users/\${userId}/edit\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          },
          body: JSON.stringify(body)
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) {
          const errorMsg = result.error || result.message || 'Cập nhật thất bại'
          console.error('Edit user failed:', errorMsg)
          throw new Error(errorMsg)
        }
        
        alert('Chỉnh sửa thành công!')
        closeEditModal()
        // Force reload users list
        await loadUsers()
      } catch (error) {
        console.error('Error saving user edit:', error)
        showError(error.message)
      }
    }
    
    // Setup login button and enter key
    const loginButton = document.getElementById('loginButton')
    const tokenInput = document.getElementById('tokenInput')
    
    if (loginButton) {
      loginButton.addEventListener('click', saveToken)
    }
    
    if (tokenInput) {
      tokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveToken()
      })
    }
    
    // Check if token exists
    if (ADMIN_TOKEN) {
      document.getElementById('authForm').classList.add('hidden')
      document.getElementById('dashboard').classList.remove('hidden')
      try {
        refreshData()
      } catch (error) {
        console.error('Error loading dashboard:', error)
      }
    }
    
    async function saveToken() {
      const token = document.getElementById('tokenInput').value.trim()
      if (!token) {
        document.getElementById('authError').textContent = 'Vui lòng nhập Admin Token'
        document.getElementById('authError').classList.remove('hidden')
        return
      }
      
      // Test token trước khi lưu
      try {
        const testResponse = await fetch(\`\${API_BASE}/api/admin/test-token\`, {
          headers: { 'Authorization': \`Bearer \${token}\` }
        })
        const testResult = await testResponse.json()
        
        if (!testResult.ok) {
          document.getElementById('authError').textContent = 'Token không hợp lệ: ' + (testResult.message || 'Vui lòng kiểm tra lại')
          document.getElementById('authError').classList.remove('hidden')
          return
        }
      } catch (error) {
        console.error('Error testing token:', error)
        document.getElementById('authError').textContent = 'Lỗi khi kiểm tra token: ' + error.message
        document.getElementById('authError').classList.remove('hidden')
        return
      }
      
      ADMIN_TOKEN = token
      localStorage.setItem('admin_token', token)
      document.getElementById('authForm').classList.add('hidden')
      document.getElementById('dashboard').classList.remove('hidden')
      
      // Load data với error handling
      try {
        await refreshData()
      } catch (error) {
        console.error('Error loading dashboard data:', error)
        showError('Đã đăng nhập thành công nhưng có lỗi khi tải dữ liệu: ' + error.message)
      }
    }
    
    async function fetchWithAuth(url, options = {}) {
      if (!ADMIN_TOKEN) throw new Error('Chưa có admin token')
      const response = await fetch(url, { 
        ...options,
        headers: { 
          'Authorization': \`Bearer \${ADMIN_TOKEN}\`,
          ...(options.headers || {})
        } 
      })
      if (response.status === 401) {
        localStorage.removeItem('admin_token')
        ADMIN_TOKEN = ''
        document.getElementById('authForm').classList.remove('hidden')
        document.getElementById('dashboard').classList.add('hidden')
        document.getElementById('tokenInput').value = ''
        throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
      }
      if (!response.ok) throw new Error(\`Lỗi HTTP \${response.status}: \${response.statusText}\`)
      return response.json()
    }
    
    function showError(message) {
      const container = document.getElementById('errorContainer')
      const div = document.createElement('div')
      div.className = 'error'
      div.textContent = 'Lỗi: ' + message
      container.innerHTML = ''
      container.appendChild(div)
    }
    
    function clearError() { document.getElementById('errorContainer').innerHTML = '' }
    
    function updateLastUpdate() {
      const now = new Date()
      document.getElementById('lastUpdate').textContent = now.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }
    
    async function loadStats() {
      try {
        const hours = parseInt(document.getElementById('hoursFilter').value) || 24
        const stats = await fetchWithAuth(\`\${API_BASE}/api/admin/stats?hours=\${hours}\`)
        if (!stats.ok) throw new Error(stats.error)
        
        const total = stats.stats.total || 0
        const critical = stats.stats.bySeverity.critical || 0
        const high = stats.stats.bySeverity.high || 0
        const medium = stats.stats.bySeverity.medium || 0
        const low = stats.stats.bySeverity.low || 0
        
        document.getElementById('totalEvents').textContent = formatNumber(total)
        document.getElementById('totalEventsLabel').textContent = \`trong \${hours} giờ qua\`
        document.getElementById('criticalCount').textContent = formatNumber(critical)
        document.getElementById('highCount').textContent = formatNumber(high)
        document.getElementById('mediumCount').textContent = formatNumber(medium)
        document.getElementById('lowCount').textContent = formatNumber(low)
        
        updateTypeChart(stats.stats.byType)
        updateSeverityChart(stats.stats.bySeverity)
        updateLastUpdate()
      } catch (error) { showError(error.message) }
    }
    
    function updateTypeChart(byType) {
      const ctx = document.getElementById('typeChart').getContext('2d')
      if (typeChart) typeChart.destroy()
      
      const labels = Object.keys(byType).map(key => eventTypeLabels[key] || key)
      const data = Object.values(byType)
      
      typeChart = new Chart(ctx, {
        type: 'bar',
        data: { 
          labels: labels, 
          datasets: [{ 
            label: 'Số Lượng', 
            data: data, 
            backgroundColor: 'rgba(14, 165, 233, 0.8)',
            borderColor: '#0ea5e9',
            borderWidth: 2
          }] 
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: true,
          plugins: { 
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => \`\${context.parsed.y} sự kiện\`
              }
            }
          }, 
          scales: { 
            y: { 
              beginAtZero: true, 
              ticks: { color: '#94a3b8', callback: (value) => formatNumber(value) }, 
              grid: { color: '#334155' } 
            }, 
            x: { 
              ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 45 }, 
              grid: { color: '#334155', display: false } 
            } 
          } 
        }
      })
    }
    
    function updateSeverityChart(bySeverity) {
      const ctx = document.getElementById('severityChart').getContext('2d')
      if (severityChart) severityChart.destroy()
      
      const colors = { 
        critical: '#ef4444', 
        high: '#f97316', 
        medium: '#eab308', 
        low: '#22c55e' 
      }
      
      const labels = Object.keys(bySeverity).map(key => severityLabels[key] || key)
      const data = Object.values(bySeverity)
      const bgColors = Object.keys(bySeverity).map(s => colors[s] || '#64748b')
      
      severityChart = new Chart(ctx, {
        type: 'doughnut',
        data: { 
          labels: labels, 
          datasets: [{ 
            data: data, 
            backgroundColor: bgColors,
            borderWidth: 2,
            borderColor: '#0f172a'
          }] 
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: true,
          plugins: { 
            legend: { 
              position: 'right',
              labels: { 
                color: '#94a3b8',
                padding: 15,
                font: { size: 13 }
              } 
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const total = context.dataset.data.reduce((a, b) => a + b, 0)
                  const percent = ((context.parsed / total) * 100).toFixed(1)
                  return \`\${context.label}: \${formatNumber(context.parsed)} (\${percent}%)\`
                }
              }
            }
          } 
        }
      })
    }
    
    async function loadTimeline() {
      try {
        const hours = parseInt(document.getElementById('hoursFilter')?.value || '24') || 24
        const groupBy = document.getElementById('timelineGroupBy')?.value || 'day'
        const severity = document.getElementById('severityFilter').value
        const eventType = document.getElementById('eventTypeFilter').value
        
        const params = new URLSearchParams({ hours: hours.toString(), groupBy })
        if (severity) params.append('severity', severity)
        if (eventType) params.append('eventType', eventType)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/timeline?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        // Update trend info
        const trend = result.trend
        const trendValue = document.getElementById('timelineTrendValue')
        const currentCount = document.getElementById('timelineCurrentCount')
        const previousCount = document.getElementById('timelinePreviousCount')
        
        currentCount.textContent = formatNumber(trend.current)
        previousCount.textContent = formatNumber(trend.previous)
        
        if (trend.change > 0) {
          trendValue.textContent = \`↑ +\${trend.changePercent}%\`
          trendValue.style.color = '#ef4444'
        } else if (trend.change < 0) {
          trendValue.textContent = \`↓ \${trend.changePercent}%\`
          trendValue.style.color = '#22c55e'
        } else {
          trendValue.textContent = '→ 0%'
          trendValue.style.color = '#94a3b8'
        }
        
        // Update chart
        updateTimelineChart(result.timeline, result.groupBy)
      } catch (error) {
        console.error('Error loading timeline:', error)
      }
    }
    
    function updateTimelineChart(timeline, groupBy) {
      const ctx = document.getElementById('timelineChart').getContext('2d')
      if (timelineChart) timelineChart.destroy()
      
      const labels = timeline.map(t => {
        if (groupBy === 'hour') {
          return new Date(t.time_bucket).toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit' })
        } else if (groupBy === 'day') {
          return new Date(t.time_bucket).toLocaleDateString('vi-VN', { month: '2-digit', day: '2-digit' })
        } else {
          return t.time_bucket
        }
      })
      
      timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Tổng',
              data: timeline.map(t => t.count),
              borderColor: '#0ea5e9',
              backgroundColor: 'rgba(14, 165, 233, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.4
            },
            {
              label: 'Nghiêm Trọng',
              data: timeline.map(t => t.critical_count),
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            },
            {
              label: 'Cao',
              data: timeline.map(t => t.high_count),
              borderColor: '#f97316',
              backgroundColor: 'rgba(249, 115, 22, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            },
            {
              label: 'Trung Bình',
              data: timeline.map(t => t.medium_count),
              borderColor: '#eab308',
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            },
            {
              label: 'Thấp',
              data: timeline.map(t => t.low_count),
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: '#94a3b8',
                padding: 10,
                font: { size: 12 }
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => \`\${context.dataset.label}: \${formatNumber(context.parsed.y)}\`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                color: '#94a3b8',
                callback: (value) => formatNumber(value)
              },
              grid: { color: '#334155' }
            },
            x: {
              ticks: { color: '#94a3b8' },
              grid: { color: '#334155', display: false }
            }
          },
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
          }
        }
      })
    }
    
    async function loadEvents() {
      try {
        const severity = document.getElementById('severityFilter').value
        const eventType = document.getElementById('eventTypeFilter').value
        const params = new URLSearchParams({ limit: '100' })
        if (severity) params.append('severity', severity)
        if (eventType) params.append('eventType', eventType)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/events?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('eventsTableBody')
        if (result.events.length === 0) { 
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Không tìm thấy sự kiện nào</td></tr>'
          return 
        }
        
        tbody.innerHTML = result.events.map(event => {
          const severityClass = \`badge-\${escapeHtml(event.severity)}\`
          const severityText = severityLabels[event.severity] || escapeHtml(event.severity.toUpperCase())
          const eventTypeText = eventTypeLabels[event.event_type] || escapeHtml(event.event_type)
          const hasDetails = event.details && event.details !== '{}' && event.details.trim() !== ''
          const detailsEscaped = hasDetails ? escapeHtml(event.details) : ''

          return \`
            <tr>
              <td>\${formatDateTime(event.timestamp)}</td>
              <td>\${eventTypeText}</td>
              <td><span class="badge \${severityClass}">\${severityText}</span></td>
              <td>\${escapeHtml(event.message)}</td>
              <td><code>\${escapeHtml((event.machine_id || '').substring(0, 20))}...</code></td>
              <td>\${escapeHtml(event.username) || '-'}</td>
              <td>\${escapeHtml(event.app_version) || '-'}</td>
              <td>\${hasDetails ? \`<button class="action-btn btn-edit" onclick="showEventDetails('\${detailsEscaped}')" style="padding: 4px 8px; font-size: 11px;">📋 Xem</button>\` : '-'}</td>
            </tr>
          \`
        }).join('')
      } catch (error) { showError(error.message) }
    }
    
    async function refreshData() { 
      if (!ADMIN_TOKEN) return
      clearError()
      try {
        await Promise.all([
          loadStats().catch(err => { console.error('Error loading stats:', err); return null }),
          loadEvents().catch(err => { console.error('Error loading events:', err); return null }),
          loadTimeline().catch(err => { console.error('Error loading timeline:', err); return null })
        ])
      } catch (error) {
        console.error('Error in refreshData:', error)
        showError('Lỗi khi tải dữ liệu: ' + error.message)
      }
    }
    
    function autoRefresh() {
      if (autoRefreshInterval) { 
        clearInterval(autoRefreshInterval)
        autoRefreshInterval = null
        document.getElementById('autoRefreshStatus').textContent = 'TẮT'
      } else { 
        autoRefreshInterval = setInterval(refreshData, 30000)
        document.getElementById('autoRefreshStatus').textContent = 'BẬT'
      }
    }
    
    // Show event details
    function showEventDetails(detailsJson) {
      try {
        // Unescape HTML entities
        const unescaped = detailsJson.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        const details = JSON.parse(unescaped)
        const formatted = JSON.stringify(details, null, 2)
        document.getElementById('eventDetailsContent').textContent = formatted
        document.getElementById('eventDetailsModal').classList.add('active')
      } catch (error) {
        // If not valid JSON, show as-is
        const unescaped = detailsJson.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        document.getElementById('eventDetailsContent').textContent = unescaped
        document.getElementById('eventDetailsModal').classList.add('active')
      }
    }
    
    function closeEventDetailsModal() {
      document.getElementById('eventDetailsModal').classList.remove('active')
    }
    
    // Show user machines
    async function showUserMachines(username) {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${username}/machines\`)
        if (!result.ok) throw new Error(result.error || 'Không thể tải thông tin máy')
        
        const content = document.getElementById('userMachinesContent')
        if (result.machines.length === 0) {
          content.innerHTML = '<div class="empty-state">Không có máy nào</div>'
        } else {
          content.innerHTML = result.machines.map(m => {
            const firstSeen = formatDateTime(m.first_seen)
            const lastSeen = formatDateTime(m.last_seen)
            return \`
              <div class="machine-item">
                <code>\${m.machine_id}</code>
                <div class="info">Lần đầu: \${firstSeen}</div>
                <div class="info">Lần cuối: \${lastSeen}</div>
                <div class="info">Số lần truy cập: \${formatNumber(m.request_count)}</div>
              </div>
            \`
          }).join('')
        }
        
        document.getElementById('userMachinesModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function closeUserMachinesModal() {
      document.getElementById('userMachinesModal').classList.remove('active')
    }
    
    // Show auto-block rules
    async function showAutoBlockRules() {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/auto-block-rules\`)
        if (!result.ok) throw new Error(result.error)
        
        const content = document.getElementById('autoBlockRulesContent')
        if (result.rules.length === 0) {
          content.innerHTML = '<div class="empty-state">Không có quy tắc nào</div>'
        } else {
          const actionLabels = { block: '🚫 Chặn', revoke_license: '🔑 Thu Hồi License', warn: '⚠️ Cảnh Báo' }
          content.innerHTML = \`
            <div style="margin-bottom: 20px; color: #94a3b8; font-size: 14px;">
              Hệ thống sẽ tự động thực hiện hành động khi đạt ngưỡng sự kiện trong khoảng thời gian quy định.
            </div>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 2px solid #334155;">
                  <th style="padding: 12px; text-align: left; font-size: 12px; color: #94a3b8;">Loại Sự Kiện</th>
                  <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Mức Độ</th>
                  <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Ngưỡng</th>
                  <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Thời Gian</th>
                  <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Hành Động</th>
                </tr>
              </thead>
              <tbody>
                \${result.rules.map(rule => {
                  const eventTypeText = eventTypeLabels[rule.eventType] || rule.eventType
                  const severityText = severityLabels[rule.severity] || rule.severity
                  const actionText = actionLabels[rule.action] || rule.action
                  return \`
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 12px;"><strong>\${eventTypeText}</strong></td>
                      <td style="padding: 12px; text-align: center;"><span class="badge badge-\${rule.severity}">\${severityText}</span></td>
                      <td style="padding: 12px; text-align: center; font-weight: 600; color: #0ea5e9;">\${rule.threshold}</td>
                      <td style="padding: 12px; text-align: center; color: #94a3b8;">\${rule.timeWindowSeconds}s</td>
                      <td style="padding: 12px; text-align: center;">\${actionText}</td>
                    </tr>
                  \`
                }).join('')}
              </tbody>
            </table>
          \`
        }
        
        document.getElementById('autoBlockRulesModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function closeAutoBlockRulesModal() {
      document.getElementById('autoBlockRulesModal').classList.remove('active')
    }
    
    // Export functions
    async function exportEvents(format) {
      try {
        const severity = document.getElementById('severityFilter').value
        const eventType = document.getElementById('eventTypeFilter').value
        const hours = parseInt(document.getElementById('hoursFilter')?.value || '24') || 24
        
        const params = new URLSearchParams({ format, hours })
        if (severity) params.append('severity', severity)
        if (eventType) params.append('eventType', eventType)
        
        const url = \`\${API_BASE}/api/admin/export/events?\${params}\`
        const response = await fetch(url, {
          headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\` }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const blob = await response.blob()
        const downloadUrl = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = \`events_\${Date.now()}.\${format}\`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(downloadUrl)
      } catch (error) {
        showError(error.message)
      }
    }
    
    async function exportUsers(format) {
      try {
        const status = document.getElementById('userStatusFilter').value
        const search = document.getElementById('userSearchInput').value.trim()
        
        const params = new URLSearchParams({ format })
        if (status) params.append('status', status)
        if (search) params.append('search', search)
        
        const url = \`\${API_BASE}/api/admin/export/users?\${params}\`
        const response = await fetch(url, {
          headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\` }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const blob = await response.blob()
        const downloadUrl = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = \`users_\${Date.now()}.\${format}\`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(downloadUrl)
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Bulk actions
    let selectedUserIds = new Set()
    let currentUsersPage = 1
    let currentUsersTotal = 0
    let currentUsersPageSize = 25
    
    function toggleSelectAll() {
      const checkbox = document.getElementById('selectAllUsers')
      const checkboxes = document.querySelectorAll('input[type="checkbox"][data-user-id]')
      
      checkboxes.forEach(cb => {
        cb.checked = checkbox.checked
        if (checkbox.checked) {
          selectedUserIds.add(cb.dataset.userId)
        } else {
          selectedUserIds.delete(cb.dataset.userId)
        }
      })
      
      updateBulkActionsBar()
    }
    
    function toggleUserSelection(userId) {
      if (selectedUserIds.has(userId)) {
        selectedUserIds.delete(userId)
      } else {
        selectedUserIds.add(userId)
      }
      updateBulkActionsBar()
      updateSelectAllCheckbox()
    }
    
    function updateSelectAllCheckbox() {
      const checkbox = document.getElementById('selectAllUsers')
      const checkboxes = document.querySelectorAll('input[type="checkbox"][data-user-id]')
      const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length
      checkbox.checked = checkedCount === checkboxes.length && checkboxes.length > 0
      checkbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length
    }
    
    function clearSelection() {
      selectedUserIds.clear()
      document.querySelectorAll('input[type="checkbox"][data-user-id]').forEach(cb => cb.checked = false)
      document.getElementById('selectAllUsers').checked = false
      updateBulkActionsBar()
    }
    
    function updateBulkActionsBar() {
      const bar = document.getElementById('bulkActionsBar')
      const count = document.getElementById('selectedCount')
      count.textContent = \`\${selectedUserIds.size} đã chọn\`
      bar.style.display = selectedUserIds.size > 0 ? 'block' : 'none'
    }
    
    async function bulkUpdateUsers(status) {
      if (selectedUserIds.size === 0) {
        alert('Vui lòng chọn ít nhất một người dùng!')
        return
      }
      
      const statusText = status === 'CHO_PHEP' ? 'Duyệt' : status === 'CHAN' ? 'Chặn' : 'Về Chờ Duyệt'
      if (!confirm(\`Bạn chắc chắn muốn \${statusText} \${selectedUserIds.size} người dùng đã chọn?\`)) return
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/users/bulk-update\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          },
          body: JSON.stringify({ userIds: Array.from(selectedUserIds), status })
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Cập nhật thất bại')
        
        alert(\`Đã cập nhật \${result.changes} người dùng thành công!\`)
        clearSelection()
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Pagination
    function changeUsersPage(delta) {
      const totalPages = Math.ceil(currentUsersTotal / currentUsersPageSize)
      const newPage = currentUsersPage + delta
      if (newPage >= 1 && newPage <= totalPages) {
        currentUsersPage = newPage
        loadUsers()
      }
    }
    
    function updateUsersPagination() {
      const totalPages = Math.ceil(currentUsersTotal / currentUsersPageSize)
      const start = (currentUsersPage - 1) * currentUsersPageSize + 1
      const end = Math.min(currentUsersPage * currentUsersPageSize, currentUsersTotal)
      
      document.getElementById('usersPaginationInfo').textContent = 
        \`Hiển thị \${start}-\${end} / \${currentUsersTotal}\`
      
      document.getElementById('usersPrevBtn').disabled = currentUsersPage === 1
      document.getElementById('usersNextBtn').disabled = currentUsersPage >= totalPages
      
      const pageNumbers = document.getElementById('usersPageNumbers')
      pageNumbers.innerHTML = ''
      
      const maxPages = 5
      let startPage = Math.max(1, currentUsersPage - Math.floor(maxPages / 2))
      let endPage = Math.min(totalPages, startPage + maxPages - 1)
      if (endPage - startPage < maxPages - 1) {
        startPage = Math.max(1, endPage - maxPages + 1)
      }
      
      for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button')
        btn.textContent = i
        btn.style.padding = '8px 12px'
        btn.style.background = i === currentUsersPage ? '#0ea5e9' : '#0f172a'
        btn.style.border = '1px solid #334155'
        btn.style.borderRadius = '6px'
        btn.style.color = '#e2e8f0'
        btn.style.cursor = 'pointer'
        btn.onclick = () => { currentUsersPage = i; loadUsers() }
        pageNumbers.appendChild(btn)
      }
    }
    
    // Update loadUsers to support search and pagination
    const originalLoadUsers = loadUsers
    loadUsers = async function() {
      try {
        const status = document.getElementById('userStatusFilter').value
        const search = document.getElementById('userSearchInput').value.trim()
        currentUsersPageSize = parseInt(document.getElementById('usersPageSize').value) || 25
        const offset = (currentUsersPage - 1) * currentUsersPageSize
        
        const params = new URLSearchParams({ 
          limit: currentUsersPageSize.toString(),
          offset: offset.toString()
        })
        if (status) params.append('status', status)
        if (search) params.append('search', search)

        const response = await fetch(\`\${API_BASE}/api/admin/users?\${params}\`, {
          headers: { 
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) throw new Error(result.error)
        
        currentUsersTotal = result.total || 0
        updateUsersPagination()
        
        const tbody = document.getElementById('usersTableBody')
        if (!result.users || result.users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Không tìm thấy người dùng nào</td></tr>'
          return
        }

        tbody.innerHTML = result.users.map(user => {
          const safeTaiKhoan = escapeHtml(user.tai_khoan)
          const safeMaMay = escapeHtml(user.ma_may)
          const safeVersion = escapeHtml(user.version)
          const statusClass = \`status-\${escapeHtml(user.trang_thai.toLowerCase())}\`
          const statusText = statusLabels[user.trang_thai] || escapeHtml(user.trang_thai)
          const createdDate = new Date(user.thoi_gian_tao).toLocaleString('vi-VN')
          const lastActive = user.last_active ? formatDateTime(user.last_active) : 'Chưa có'
          const machineIdCell = user.ma_may
            ? \`<span class="clickable" title="Xem chi tiết" onclick="openUserDetail('\${user.id}')"><code>\${safeMaMay.substring(0, 24)}...</code></span>\`
            : '<span style="color: #64748b;">-</span>'
          const activationKey = user.key_kich_hoat
            ? \`<span class="clickable" title="Xem chi tiết key" onclick="openUserDetail('\${user.id}')"><code style="font-size: 11px;">\${escapeHtml(user.key_kich_hoat.substring(0, 20))}...</code></span>\`
            : '<span style="color: #64748b;">-</span>'
          const machineCount = user.machine_count || 0
          const multipleMachinesWarning = machineCount > 1 ? \`<span style="color: #f97316; font-size: 12px; cursor: pointer;" onclick="showUserMachines('\${safeTaiKhoan}')" title="⚠️ Click để xem chi tiết \${machineCount} máy">⚠️ \${machineCount}</span>\` : (machineCount > 0 ? \`<span style="cursor: pointer;" onclick="showUserMachines('\${safeTaiKhoan}')" title="Click để xem chi tiết">\${machineCount}</span>\` : '0')
          const isSelected = selectedUserIds.has(user.id)

          // V2: Get key_status
          const keyStatus = user.key_status || 'PENDING'
          const keyStatusLabels = {
            'PENDING': '⏳ Chờ',
            'ACTIVE': '✅ Hoạt động',
            'LOCKED': '🔒 Đã khóa',
            'REVOKED': '🚫 Đã thu hồi'
          }
          const keyStatusText = keyStatusLabels[keyStatus] || escapeHtml(keyStatus)

          let actions = \`<button class="action-btn btn-edit" onclick="openEditModal('\${user.id}')">✏️ Sửa</button>\`
          if (user.trang_thai === 'CHO_DUYET') {
            actions += \`<button class="action-btn btn-approve" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')">✅ Duyệt</button>
                       <button class="action-btn btn-block" onclick="updateUserStatus('\${user.id}', 'CHAN')">🚫 Chặn</button>\`
          } else if (user.trang_thai === 'CHO_PHEP') {
            actions += \`<button class="action-btn btn-block" onclick="updateUserStatus('\${user.id}', 'CHAN')">🚫 Chặn</button>\`
            // V2: Key management actions
            if (keyStatus === 'LOCKED') {
              actions += \`<button class="action-btn btn-unlock" onclick="unlockKey('\${safeTaiKhoan}')" title="Mở khóa key">🔓 Mở khóa</button>\`
            }
            if (keyStatus === 'ACTIVE' || keyStatus === 'LOCKED') {
              actions += \`<button class="action-btn btn-revoke" onclick="revokeKey('\${safeTaiKhoan}')" title="Thu hồi key">🔑 Thu hồi</button>\`
            }
            actions += \`<button class="action-btn btn-rebind" onclick="allowRebind('\${safeTaiKhoan}')" title="Cho phép đổi máy">🔄 Đổi máy</button>\`
          } else if (user.trang_thai === 'CHAN') {
            actions += \`<button class="action-btn btn-unblock" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')">🔓 Bỏ Chặn</button>\`
          }

          return \`
            <tr>
              <td><input type="checkbox" data-user-id="\${user.id}" \${isSelected ? 'checked' : ''} onchange="toggleUserSelection('\${user.id}')"></td>
              <td><strong>\${safeTaiKhoan}</strong></td>
              <td>\${machineIdCell}</td>
              <td><span class="status-badge \${statusClass}">\${statusText}</span></td>
              <td>\${multipleMachinesWarning}</td>
              <td>\${activationKey}</td>
              <td><span class="status-badge" style="font-size: 11px;">\${keyStatusText}</span></td>
              <td>\${lastActive}</td>
              <td>\${createdDate}</td>
              <td><code style="font-size: 11px; color: #0ea5e9;">\${safeVersion || '-'}</code></td>
              <td>\${actions}</td>
            </tr>
          \`
        }).join('')
        
        updateSelectAllCheckbox()
      } catch (error) { 
        showError(error.message) 
      }
    }
    
    // Search debounce
    let searchTimeout = null
    document.addEventListener('DOMContentLoaded', () => {
      const searchInput = document.getElementById('userSearchInput')
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(searchTimeout)
          searchTimeout = setTimeout(() => {
            currentUsersPage = 1
            loadUsers()
          }, 500)
        })
      }
    })
    
    // Activity Log
    const actionTypeLabels = {
      'approve': '✅ Duyệt',
      'block': '🚫 Chặn',
      'unblock': '🔓 Bỏ Chặn',
      'edit': '✏️ Chỉnh Sửa',
      'bulk_approve': '✅ Duyệt Hàng Loạt',
      'bulk_block': '🚫 Chặn Hàng Loạt',
      'bulk_unblock': '🔓 Bỏ Chặn Hàng Loạt',
      'revoke_key': '🔑 Thu Hồi Key',
      'regenerate_key': '🔑 Tạo Lại Key'
    }
    
    async function loadActivityLog() {
      try {
        const actionType = document.getElementById('activityActionFilter').value
        const targetType = document.getElementById('activityTargetFilter').value
        const hours = parseInt(document.getElementById('activityHoursFilter')?.value || '24') || 24
        
        const params = new URLSearchParams({ hours: hours.toString(), limit: '100' })
        if (actionType) params.append('actionType', actionType)
        if (targetType) params.append('targetType', targetType)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/activity-log?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('activityTableBody')
        if (!result.activities || result.activities.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Không có hoạt động nào</td></tr>'
          return
        }
        
        tbody.innerHTML = result.activities.map(activity => {
          const actionText = actionTypeLabels[activity.action_type] || escapeHtml(activity.action_type)
          const oldValueStr = activity.old_value ? escapeHtml(JSON.stringify(activity.old_value, null, 2).substring(0, 100)) : '-'
          const newValueStr = activity.new_value ? escapeHtml(JSON.stringify(activity.new_value, null, 2).substring(0, 100)) : '-'

          return \`
            <tr>
              <td>\${formatDateTime(activity.timestamp)}</td>
              <td><strong>\${actionText}</strong></td>
              <td>\${escapeHtml(activity.target_type)}</td>
              <td>\${escapeHtml(activity.target_name || activity.target_id) || '-'}</td>
              <td><code style="font-size: 11px;">\${oldValueStr}</code></td>
              <td><code style="font-size: 11px;">\${newValueStr}</code></td>
              <td>\${escapeHtml(activity.admin_ip) || '-'}</td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    // License Management
    async function loadLicenses() {
      try {
        const search = document.getElementById('licenseSearchInput')?.value.trim() || ''
        const params = new URLSearchParams()
        if (search) params.append('search', search)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/licenses?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('licensesTableBody')
        if (!result.licenses || result.licenses.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Không có license nào</td></tr>'
          return
        }
        
        tbody.innerHTML = result.licenses.map(license => {
          const statusClass = \`status-\${license.trang_thai.toLowerCase()}\`
          const statusText = statusLabels[license.trang_thai] || license.trang_thai
          const createdDate = new Date(license.thoi_gian_tao).toLocaleString('vi-VN')
          const passwordId = \`pwd-\${license.id}\`
          const rawPwd = license.mat_khau || ''
          const realPassword = rawPwd.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          const maskedPassword = rawPwd ? rawPwd.replace(/./g, '*') : '-'
          
          return \`
            <tr>
              <td><code>\${license.key_kich_hoat}</code></td>
              <td><strong>\${license.tai_khoan}</strong></td>
              <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <input 
                    type="password" 
                    id="\${passwordId}" 
                    value="\${maskedPassword}" 
                    readonly 
                    style="flex: 1; padding: 4px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 12px; min-width: 80px;"
                    data-real-password="\${realPassword}"
                  />
                  <button 
                    type="button" 
                    class="icon-btn" 
                    onclick="toggleTablePasswordVisibility('\${passwordId}', this)"
                    style="padding: 4px 8px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; cursor: pointer; font-size: 14px; \${!rawPwd ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                    title="Hiện/Ẩn mật khẩu"
                    \${!rawPwd ? 'disabled' : ''}
                  >👁️</button>
                </div>
              </td>
              <td><code>\${license.ma_may.substring(0, 24)}...</code></td>
              <td><span class="status-badge \${statusClass}">\${statusText}</span></td>
              <td>\${createdDate}</td>
              <td>
                <button class="action-btn btn-edit" onclick="revokeLicense('\${license.id}', '\${license.key_kich_hoat}')">🔑 Thu Hồi</button>
                <button class="action-btn btn-approve" onclick="regenerateLicense('\${license.id}')">🔄 Tạo Lại</button>
              </td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    async function revokeLicense(userId, key) {
      if (!confirm(\`Bạn chắc chắn muốn thu hồi key này?\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/licenses/\${userId}/revoke\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Thu hồi key thất bại')
        alert('Thu hồi key thành công!')
        await loadLicenses()
      } catch (error) {
        showError(error.message)
      }
    }
    
    async function regenerateLicense(userId) {
      if (!confirm(\`Bạn chắc chắn muốn tạo lại key cho user này?\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/licenses/\${userId}/regenerate\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Tạo lại key thất bại')
        alert(\`Tạo lại key thành công! Key mới: \${result.key_kich_hoat}\`)
        await loadLicenses()
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Alert Settings
    async function loadAlertSettings() {
      try {
        // Load settings from localStorage or API
        const emailEnabled = localStorage.getItem('emailAlertsEnabled') === 'true'
        const webhookEnabled = localStorage.getItem('webhookAlertsEnabled') === 'true'
        const alertEmail = localStorage.getItem('alertEmail') || ''
        const webhookUrl = localStorage.getItem('webhookUrl') || ''
        const alertThreshold = parseInt(localStorage.getItem('alertThreshold') || '10')
        const alertFrequency = localStorage.getItem('alertFrequency') || 'daily'
        
        document.getElementById('emailAlertsEnabled').checked = emailEnabled
        document.getElementById('webhookAlertsEnabled').checked = webhookEnabled
        document.getElementById('alertEmail').value = alertEmail
        document.getElementById('webhookUrl').value = webhookUrl
        document.getElementById('alertThreshold').value = alertThreshold
        document.getElementById('alertFrequency').value = alertFrequency
        
        // Load event type alerts
        const eventTypes = Object.keys(eventTypeLabels)
        const container = document.getElementById('eventTypeAlerts')
        container.innerHTML = eventTypes.map(eventType => {
          const enabled = localStorage.getItem(\`alert_\${eventType}\`) !== 'false'
          return \`
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
              <input type="checkbox" \${enabled ? 'checked' : ''} onchange="saveEventTypeAlert('\${eventType}', this.checked)">
              <span>\${eventTypeLabels[eventType] || eventType}</span>
            </label>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function saveAlertSettings() {
      const emailEnabled = document.getElementById('emailAlertsEnabled').checked
      const webhookEnabled = document.getElementById('webhookAlertsEnabled').checked
      const alertEmail = document.getElementById('alertEmail').value
      const webhookUrl = document.getElementById('webhookUrl').value
      const alertThreshold = parseInt(document.getElementById('alertThreshold').value)
      const alertFrequency = document.getElementById('alertFrequency').value
      
      localStorage.setItem('emailAlertsEnabled', emailEnabled.toString())
      localStorage.setItem('webhookAlertsEnabled', webhookEnabled.toString())
      localStorage.setItem('alertEmail', alertEmail)
      localStorage.setItem('webhookUrl', webhookUrl)
      localStorage.setItem('alertThreshold', alertThreshold.toString())
      localStorage.setItem('alertFrequency', alertFrequency)
    }
    
    function saveEventTypeAlert(eventType, enabled) {
      localStorage.setItem(\`alert_\${eventType}\`, enabled.toString())
    }
    
    // Version Policy Management
    async function loadVersionPolicy() {
      try {
        const response = await fetch(\`\${API_BASE}/api/version-policy\`)
        if (!response.ok) {
          const errorText = await response.text()
          console.error('Version policy API error:', response.status, errorText)
          throw new Error(\`Không thể tải version policy (HTTP \${response.status}): \${errorText}\`)
        }
        
        const policy = await response.json()
        
        // Fill form fields
        document.getElementById('policyLatestVersion').value = policy.latest_version || ''
        document.getElementById('policyMinSupportedVersion').value = policy.min_supported_version || ''
        document.getElementById('policyRecommendedVersion').value = policy.recommended_version || ''
        document.getElementById('policyRecommendedInstallerUrl').value = policy.recommended_installer_url || ''
        document.getElementById('policyBlockedVersions').value = (policy.blocked_versions || []).join(', ')
        document.getElementById('policyForceUpdate').checked = policy.force_update || false
        document.getElementById('policyMessage').value = policy.message || ''
        
        // Beta channel fields
        document.getElementById('policyBetaLatestVersion').value = policy.beta_latest_version || ''
        document.getElementById('policyBetaUpdateUrl').value = policy.beta_update_url || 'https://license-updates.pages.dev/beta/win/'
        document.getElementById('policyBetaBlockedVersions').value = (policy.beta_blocked_versions || []).join(', ')
        
        // Update preview
        document.getElementById('versionPolicyPreview').textContent = JSON.stringify(policy, null, 2)
        
        // Hide error
        const errorDiv = document.getElementById('versionPolicyError')
        if (errorDiv) {
          errorDiv.classList.add('hidden')
          errorDiv.textContent = ''
        }
      } catch (error) {
        console.error('Error loading version policy:', error)
        const errorDiv = document.getElementById('versionPolicyError')
        if (errorDiv) {
          errorDiv.classList.remove('hidden')
          errorDiv.textContent = \`Lỗi: \${error.message || 'Không thể tải version policy'}\`
        }
        document.getElementById('versionPolicyPreview').textContent = 'Lỗi khi tải policy'
      }
    }
    
    async function saveVersionPolicy() {
      try {
        // Collect form data
        const blockedVersionsStr = document.getElementById('policyBlockedVersions').value.trim()
        const blockedVersions = blockedVersionsStr 
          ? blockedVersionsStr.split(',').map(v => v.trim()).filter(v => v)
          : []
        
        const betaBlockedVersionsStr = document.getElementById('policyBetaBlockedVersions').value.trim()
        const betaBlockedVersions = betaBlockedVersionsStr
          ? betaBlockedVersionsStr.split(',').map(v => v.trim()).filter(v => v)
          : []
        
        const policy = {
          latest_version: document.getElementById('policyLatestVersion').value.trim(),
          min_supported_version: document.getElementById('policyMinSupportedVersion').value.trim(),
          recommended_version: document.getElementById('policyRecommendedVersion').value.trim(),
          recommended_installer_url: document.getElementById('policyRecommendedInstallerUrl').value.trim() || undefined,
          blocked_versions: blockedVersions,
          force_update: document.getElementById('policyForceUpdate').checked,
          message: document.getElementById('policyMessage').value.trim() || undefined,
          channel: 'stable',
          beta_latest_version: document.getElementById('policyBetaLatestVersion').value.trim() || undefined,
          beta_update_url: document.getElementById('policyBetaUpdateUrl').value.trim() || undefined,
          beta_blocked_versions: betaBlockedVersions.length > 0 ? betaBlockedVersions : undefined,
        }
        
        // Validate required fields
        if (!policy.latest_version || !policy.min_supported_version || !policy.recommended_version) {
          throw new Error('Vui lòng điền đầy đủ các trường bắt buộc: Latest Version, Min Supported Version, Recommended Version')
        }
        
        // Confirm before saving
        if (!confirm('Bạn chắc chắn muốn cập nhật version policy? Điều này có thể ảnh hưởng đến tất cả users.')) {
          return
        }
        
        const response = await fetch(\`\${API_BASE}/api/admin/version-policy/update\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ policy })
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authForm').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()
        
        if (!result.ok) {
          const errorMsg = result.error || result.details || 'Cập nhật version policy thất bại'
          console.error('Save version policy error:', result)
          throw new Error(errorMsg)
        }
        
        alert('✅ Cập nhật version policy thành công!')
        
        // Reload to show updated policy
        await loadVersionPolicy()
      } catch (error) {
        console.error('Error saving version policy:', error)
        const errorDiv = document.getElementById('versionPolicyError')
        if (errorDiv) {
          errorDiv.classList.remove('hidden')
          errorDiv.textContent = \`Lỗi: \${error.message || 'Không thể lưu version policy'}\`
        }
      }
    }
    
    if (ADMIN_TOKEN) refreshData()
  </script>
</body>
</html>`

  return new Response(dashboardHTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'Content-Security-Policy': cspPolicy,
      // Additional security headers
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  })
}
