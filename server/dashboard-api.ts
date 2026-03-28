/// <reference path="./types.d.ts" />

/**
 * Admin Dashboard API
 * Cung cấp endpoints để xem security events và statistics
 */

import { logAdminActivity } from './activity-log-api'

// =========================
// Password Hashing (duplicate from index.ts for dashboard-api.ts)
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
 * Check if a password string is already hashed
 * Hashed passwords are stored as "hash:salt" format
 */
function isPasswordHashed(password: string): boolean {
  return password.includes(':') && password.split(':').length === 2
}

interface Env {
  DB?: D1Database
  ADMIN_TOKEN?: string
}

/**
 * Get admin IP and session from request
 */
function getAdminInfo(request: Request): { ip: string | null; session: string | null } {
  const ip = request.headers.get('CF-Connecting-IP') || 
             request.headers.get('X-Forwarded-For')?.split(',')[0] || 
             null
  const session = request.headers.get('X-Session-ID') || null
  return { ip, session }
}

interface SecurityEvent {
  id: number
  event_type: string
  severity: string
  message: string
  details: string
  timestamp: number
  machine_id: string
  username: string | null
  app_version: string | null
  created_at: string
}

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Verify admin token
 */
function verifyAdminToken(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false
  }
  const token = authHeader.substring(7)
  return token === env.ADMIN_TOKEN
}

/**
 * GET /api/admin/events
 * Lấy danh sách security events với filters
 */
export async function getEvents(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const severity = url.searchParams.get('severity')
    const eventType = url.searchParams.get('eventType')
    const machineId = url.searchParams.get('machineId')
    const username = url.searchParams.get('username')
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)

    let query = 'SELECT * FROM security_events WHERE 1=1'
    const params: any[] = []

    if (severity) {
      query += ' AND severity = ?'
      params.push(severity)
    }
    if (eventType) {
      query += ' AND event_type = ?'
      params.push(eventType)
    }
    if (machineId) {
      query += ' AND machine_id = ?'
      params.push(machineId)
    }
    if (username) {
      query += ' AND username = ?'
      params.push(username)
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await env.DB.prepare(query).bind(...params).all<SecurityEvent>()

    return json({
      ok: true,
      events: result.results || [],
      total: result.results?.length || 0,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting events:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/stats
 * Lấy statistics về security events
 */
export async function getStats(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const since = Date.now() - hours * 60 * 60 * 1000

    // Events by severity
    const severityStats = await env.DB.prepare(
      `SELECT severity, COUNT(*) as count
       FROM security_events
       WHERE timestamp > ?
       GROUP BY severity`
    )
      .bind(since)
      .all<{ severity: string; count: number }>()

    // Events by type
    const typeStats = await env.DB.prepare(
      `SELECT event_type, COUNT(*) as count
       FROM security_events
       WHERE timestamp > ?
       GROUP BY event_type
       ORDER BY count DESC
       LIMIT 20`
    )
      .bind(since)
      .all<{ event_type: string; count: number }>()

    // Total events
    const totalResult = await env.DB.prepare(
      'SELECT COUNT(*) as total FROM security_events WHERE timestamp > ?'
    )
      .bind(since)
      .first<{ total: number }>()

    return json({
      ok: true,
      stats: {
        total: totalResult?.total || 0,
        bySeverity: (severityStats.results || []).reduce(
          (acc, row) => {
            acc[row.severity] = row.count
            return acc
          },
          {} as Record<string, number>
        ),
        byType: (typeStats.results || []).reduce(
          (acc, row) => {
            acc[row.event_type] = row.count
            return acc
          },
          {} as Record<string, number>
        ),
        timeRange: {
          hours,
          since,
          until: Date.now(),
        },
      },
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting stats:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/top-machines
 * Lấy top machineIds có nhiều events
 */
export async function getTopMachines(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10', 10)
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const since = Date.now() - hours * 60 * 60 * 1000

    const result = await env.DB.prepare(
      `SELECT 
         machine_id,
         COUNT(*) as event_count,
         MAX(severity) as max_severity,
         MAX(timestamp) as last_seen
       FROM security_events
       WHERE timestamp > ?
       GROUP BY machine_id
       ORDER BY event_count DESC
       LIMIT ?`
    )
      .bind(since, limit)
      .all<{
        machine_id: string
        event_count: number
        max_severity: string
        last_seen: number
      }>()

    return json({
      ok: true,
      machines: result.results || [],
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting top machines:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/top-machines-by-usage
 * Lấy top machines có thời gian sử dụng app nhiều nhất (dựa trên request_count)
 */
export async function getTopMachinesByUsage(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10', 10)

    const result = await env.DB.prepare(
      `SELECT 
         machine_id,
         username,
         request_count,
         first_seen,
         last_seen,
         (last_seen - first_seen) as active_duration_ms
       FROM machine_id_tracking
       WHERE request_count > 0
       ORDER BY request_count DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<{
        machine_id: string
        username: string | null
        request_count: number
        first_seen: number
        last_seen: number
        active_duration_ms: number
      }>()

    return json({
      ok: true,
      machines: result.results || [],
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting top machines by usage:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/timeline
 * Lấy events theo thời gian để vẽ timeline chart
 */
export async function getTimeline(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const groupBy = url.searchParams.get('groupBy') || 'hour' // 'hour', 'day', 'week'
    const severity = url.searchParams.get('severity') // Optional filter
    const eventType = url.searchParams.get('eventType') // Optional filter

    const since = Date.now() - hours * 60 * 60 * 1000

    // Determine time bucket size based on groupBy
    let timeBucket: string
    let timeFormat: string
    switch (groupBy) {
      case 'hour':
        timeBucket = "strftime('%Y-%m-%d %H:00:00', datetime(timestamp/1000, 'unixepoch'))"
        timeFormat = '%Y-%m-%d %H:00'
        break
      case 'day':
        timeBucket = "strftime('%Y-%m-%d', datetime(timestamp/1000, 'unixepoch'))"
        timeFormat = '%Y-%m-%d'
        break
      case 'week':
        timeBucket = "strftime('%Y-W%W', datetime(timestamp/1000, 'unixepoch'))"
        timeFormat = '%Y-W%W'
        break
      default:
        timeBucket = "strftime('%Y-%m-%d %H:00:00', datetime(timestamp/1000, 'unixepoch'))"
        timeFormat = '%Y-%m-%d %H:00'
    }

    let query = `
      SELECT 
        ${timeBucket} as time_bucket,
        COUNT(*) as count,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
        COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_count,
        COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_count
      FROM security_events
      WHERE timestamp > ?
    `
    const params: any[] = [since]

    if (severity) {
      query += ' AND severity = ?'
      params.push(severity)
    }

    if (eventType) {
      query += ' AND event_type = ?'
      params.push(eventType)
    }

    query += ` GROUP BY time_bucket ORDER BY time_bucket ASC`

    const result = await env.DB.prepare(query).bind(...params).all<{
      time_bucket: string
      count: number
      critical_count: number
      high_count: number
      medium_count: number
      low_count: number
    }>()

    // Calculate trend (compare with previous period)
    const previousSince = since - (Date.now() - since)
    let trendQuery = `
      SELECT COUNT(*) as previous_count
      FROM security_events
      WHERE timestamp > ? AND timestamp <= ?
    `
    const trendParams: any[] = [previousSince, since]

    if (severity) {
      trendQuery += ' AND severity = ?'
      trendParams.push(severity)
    }

    if (eventType) {
      trendQuery += ' AND event_type = ?'
      trendParams.push(eventType)
    }

    const trendResult = await env.DB.prepare(trendQuery).bind(...trendParams).first<{ previous_count: number }>()
    const previousCount = trendResult?.previous_count || 0
    const currentCount = (result.results || []).reduce((sum, row) => sum + row.count, 0)
    const trend = previousCount > 0 
      ? ((currentCount - previousCount) / previousCount * 100).toFixed(1)
      : currentCount > 0 ? '100.0' : '0.0'

    return json({
      ok: true,
      timeline: result.results || [],
      trend: {
        current: currentCount,
        previous: previousCount,
        change: parseFloat(trend),
        changePercent: parseFloat(trend),
      },
      groupBy,
      timeFormat,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting timeline:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/top-usernames
 * Lấy top usernames có nhiều events
 */
export async function getTopUsernames(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10', 10)
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const since = Date.now() - hours * 60 * 60 * 1000

    const result = await env.DB.prepare(
      `SELECT 
         username,
         COUNT(*) as event_count,
         MAX(severity) as max_severity,
         MAX(timestamp) as last_seen
       FROM security_events
       WHERE timestamp > ? AND username IS NOT NULL
       GROUP BY username
       ORDER BY event_count DESC
       LIMIT ?`
    )
      .bind(since, limit)
      .all<{
        username: string
        event_count: number
        max_severity: string
        last_seen: number
      }>()

    return json({
      ok: true,
      usernames: result.results || [],
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting top usernames:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/top-users-video-exports
 * Lấy top users xuất video nhiều nhất
 */
export async function getTopUsersVideoExports(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10', 10)

    // Check if video_exports table exists
    let hasVideoExportsTable = false
    try {
      const tableCheck = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='video_exports'"
      ).first<{ name: string }>()
      hasVideoExportsTable = !!tableCheck
    } catch (e) {
      hasVideoExportsTable = false
    }

    if (!hasVideoExportsTable) {
      return json({
        ok: true,
        users: [],
      })
    }

    const result = await env.DB.prepare(
      `SELECT 
         username,
         COUNT(*) as total_exports,
         COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
         COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
         MAX(timestamp) as last_export_time
       FROM video_exports
       GROUP BY username
       ORDER BY total_exports DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<{
        username: string
        total_exports: number
        success_count: number
        failed_count: number
        last_export_time: number | null
      }>()

    return json({
      ok: true,
      users: result.results || [],
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting top users video exports:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/users
 * Lấy danh sách tất cả users
 */
export async function getUsers(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') // CHO_DUYET, CHO_PHEP, CHAN
    const search = url.searchParams.get('search') // Search in tai_khoan or ma_may
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)

    // Check which columns exist in the registrations table
    let hasMatKhauColumn = false
    let hasVersionColumn = false
    let hasKeyStatusColumn = false
    try {
      const schemaCheck = await env.DB.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='registrations'"
      ).first<{ sql: string }>()
      if (schemaCheck?.sql) {
        hasMatKhauColumn = schemaCheck.sql.includes('mat_khau')
        hasVersionColumn = schemaCheck.sql.includes('version')
        hasKeyStatusColumn = schemaCheck.sql.includes('key_status')
      }
    } catch (e) {
      // If we can't check schema, assume columns exist and let query fail naturally
      hasMatKhauColumn = true
      hasVersionColumn = true
      hasKeyStatusColumn = true
    }

    // Check if video_exports table exists
    let hasVideoExportsTable = false
    try {
      const tableCheck = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='video_exports'"
      ).first<{ name: string }>()
      hasVideoExportsTable = !!tableCheck
    } catch (e) {
      hasVideoExportsTable = false
    }

    let query = `
      SELECT 
        r.id,
        r.tai_khoan,
        ${hasMatKhauColumn ? 'COALESCE(r.mat_khau, \'\') as mat_khau,' : '\'\' as mat_khau,'}
        r.ma_may,
        r.trang_thai,
        r.thoi_gian_tao,
        r.key_kich_hoat,
        ${hasKeyStatusColumn ? 'r.key_status,' : '\'PENDING\' as key_status,'}
        ${hasVersionColumn ? 'r.version,' : 'NULL as version,'}
        (SELECT COUNT(*) FROM machine_id_tracking WHERE username = r.tai_khoan) as machine_count,
        (SELECT MAX(last_seen) FROM machine_id_tracking WHERE username = r.tai_khoan) as last_active,
        ${hasVideoExportsTable ? `
        (SELECT COUNT(*) FROM video_exports WHERE username = r.tai_khoan AND status = 'success') as video_success_count,
        (SELECT COUNT(*) FROM video_exports WHERE username = r.tai_khoan AND status = 'failed') as video_failed_count
        ` : `
        0 as video_success_count,
        0 as video_failed_count
        `}
      FROM registrations r
      WHERE 1=1
    `
    const params: any[] = []

    if (status) {
      query += ' AND r.trang_thai = ?'
      params.push(status)
    }

    if (search) {
      query += ' AND (r.tai_khoan LIKE ? OR r.ma_may LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern)
    }

    query += ' ORDER BY r.thoi_gian_tao DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await env.DB.prepare(query).bind(...params).all<{
      id: string
      tai_khoan: string
      mat_khau: string | null
      ma_may: string
      trang_thai: string
      thoi_gian_tao: number
      key_kich_hoat: string | null
      key_status: string | null
      version: string | null
      machine_count: number
      last_active: number | null
      video_success_count: number
      video_failed_count: number
    }>()

    // Debug: Log first user to check mat_khau field
    if (result.results && result.results.length > 0) {
      const firstUser = result.results[0] as any
      console.log('[Dashboard API] First user sample:', {
        tai_khoan: firstUser.tai_khoan,
        hasMatKhau: 'mat_khau' in firstUser,
        matKhauLength: firstUser.mat_khau?.length || 0,
        matKhauPreview: firstUser.mat_khau ? firstUser.mat_khau.substring(0, 10) + '...' : 'null'
      })
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM registrations WHERE 1=1'
    const countParams: any[] = []
    if (status) {
      countQuery += ' AND trang_thai = ?'
      countParams.push(status)
    }
    if (search) {
      countQuery += ' AND (tai_khoan LIKE ? OR ma_may LIKE ?)'
      const searchPattern = `%${search}%`
      countParams.push(searchPattern, searchPattern)
    }
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>()

    return json({
      ok: true,
      users: result.results || [],
      total: countResult?.total || 0,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting users:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * POST /api/admin/users/:id/update
 * Update status của user
 */
export async function updateUserStatus(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    // URL format: /api/admin/users/:id/update
    // Need to get the ID (second to last part)
    const parts = url.pathname.split('/').filter(p => p)
    // parts = ['api', 'admin', 'users', '64bc008b-...', 'update']
    // ID is at index parts.length - 2
    const id = parts.length >= 4 ? parts[parts.length - 2] : null
    
    const body = await request.json().catch(() => ({}))
    const { status } = body as { status?: string }

    if (!id || !status || !['CHO_DUYET', 'CHO_PHEP', 'CHAN'].includes(status)) {
      console.error('[Dashboard API] Invalid ID or status:', { id, status, pathname: url.pathname, parts })
      return json({ error: 'Invalid id or status' }, 400)
    }
    
    console.log('[Dashboard API] Updating user status:', { id, status })

    // Check current status to only generate key if changing TO CHO_PHEP
    const currentUser = await env.DB.prepare(
      'SELECT trang_thai FROM registrations WHERE id = ?'
    )
      .bind(id)
      .first<{ trang_thai: string }>()
    
    if (!currentUser) {
      return json({ error: 'User not found' }, 404)
    }
    
    const currentStatus = currentUser.trang_thai
    const isStatusChanging = currentStatus !== status
    
    // Get current key before update (if exists)
    const userWithKey = await env.DB.prepare('SELECT key_kich_hoat FROM registrations WHERE id = ?')
      .bind(id)
      .first<{ key_kich_hoat: string | null }>()
    
    let key_kich_hoat: string | null = userWithKey?.key_kich_hoat || null

    // V2: Update key_status when approving
    let updateQuery = `UPDATE registrations 
       SET trang_thai = ?1`
    const updateParams: any[] = [status]
    
    if (status === 'CHO_PHEP' && isStatusChanging) {
      // V2: Set key_status='ACTIVE' when approving
      updateQuery += `, key_status = 'ACTIVE'`
      // Nếu chưa có key, tạo mới
      if (!key_kich_hoat) {
        key_kich_hoat = crypto.randomUUID()
        updateQuery += `, key_kich_hoat = ?2`
        updateParams.push(key_kich_hoat)
      }
    }
    
    updateQuery += ` WHERE id = ?${updateParams.length + 1}`
    updateParams.push(id)
    
    const result = await env.DB.prepare(updateQuery).bind(...updateParams).run()
    
    console.log('[Dashboard API] Update status result:', { 
      id, 
      success: result.success,
      key_kich_hoat: key_kich_hoat
    })
    
    // D1Database doesn't have result.meta.changes, check success instead
    if (!result.success) {
      console.warn('[Dashboard API] Update failed for id:', id)
      return json({ 
        ok: false, 
        error: 'Không tìm thấy user với ID này hoặc không có thay đổi nào' 
      }, 404)
    }

    // Get final key after update to return
    const finalKeyResult = await env.DB.prepare('SELECT key_kich_hoat FROM registrations WHERE id = ?')
      .bind(id)
      .first<{ key_kich_hoat: string | null }>()
    
    const finalKey = finalKeyResult?.key_kich_hoat || key_kich_hoat

    // V2: Ghi audit log khi approve
    if (status === 'CHO_PHEP' && isStatusChanging) {
      try {
        const user = await env.DB.prepare('SELECT tai_khoan, ma_may FROM registrations WHERE id = ?')
          .bind(id)
          .first<{ tai_khoan: string; ma_may: string }>()
        
        if (user) {
          await env.DB.prepare(
            `INSERT INTO auth_audit_logs (id, username, event_type, severity, ip_address, machine_id, details, timestamp)
             VALUES (?1, ?2, 'APPROVE', 'info', ?3, ?4, ?5, ?6)`
          )
            .bind(
              crypto.randomUUID(),
              user.tai_khoan,
              getAdminInfo(request).ip || 'unknown',
              user.ma_may,
              JSON.stringify({ action: 'CHO_PHEP', key_kich_hoat: finalKey }),
              Date.now()
            )
            .run()
        }
      } catch (err) {
        console.warn('[Dashboard API] Failed to write audit log:', err)
      }
    }

    return json({
      ok: true,
      message: 'Cập nhật thành công',
      key_kich_hoat: status === 'CHO_PHEP' ? finalKey : null, // Trả về key khi approve
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error updating user:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/users/:id
 * Lấy thông tin chi tiết của user
 */
export async function getUser(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const id = url.pathname.split('/').pop()

    if (!id) {
      return json({ error: 'Invalid id' }, 400)
    }

    const user = await env.DB.prepare(
      `SELECT id, tai_khoan, mat_khau, ma_may, trang_thai, thoi_gian_tao, key_kich_hoat, version
       FROM registrations
       WHERE id = ?`
    )
      .bind(id)
      .first<{
        id: string
        tai_khoan: string
        mat_khau: string
        ma_may: string
        trang_thai: string
        thoi_gian_tao: number
        key_kich_hoat: string | null
        version: string | null
      }>()

    if (!user) {
      return json({ error: 'User not found' }, 404)
    }

    return json({
      ok: true,
      user,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting user:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/audit-logs
 * Lấy danh sách auth audit logs với filters
 */
export async function getAuditLogs(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const eventType = url.searchParams.get('eventType')
    const severity = url.searchParams.get('severity')
    const username = url.searchParams.get('username')
    const machineId = url.searchParams.get('machineId')
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)

    const since = Date.now() - hours * 60 * 60 * 1000

    let query = 'SELECT * FROM auth_audit_logs WHERE timestamp > ?'
    const params: any[] = [since]

    if (eventType) {
      query += ' AND event_type = ?'
      params.push(eventType)
    }
    if (severity) {
      query += ' AND severity = ?'
      params.push(severity)
    }
    if (username) {
      query += ' AND username = ?'
      params.push(username)
    }
    if (machineId) {
      query += ' AND machine_id = ?'
      params.push(machineId)
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await env.DB.prepare(query).bind(...params).all<{
      id: string
      username: string
      event_type: string
      severity: string
      ip_address: string | null
      machine_id: string | null
      details: string | null
      timestamp: number
    }>()

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM auth_audit_logs WHERE timestamp > ?'
    const countParams: any[] = [since]
    if (eventType) {
      countQuery += ' AND event_type = ?'
      countParams.push(eventType)
    }
    if (severity) {
      countQuery += ' AND severity = ?'
      countParams.push(severity)
    }
    if (username) {
      countQuery += ' AND username = ?'
      countParams.push(username)
    }
    if (machineId) {
      countQuery += ' AND machine_id = ?'
      countParams.push(machineId)
    }
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>()

    return json({
      ok: true,
      logs: result.results || [],
      total: countResult?.total || 0,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting audit logs:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * POST /api/admin/users/:id/edit
 * Chỉnh sửa thông tin user (tài khoản, mật khẩu, mã máy, trạng thái)
 */
export async function editUser(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    // URL format: /api/admin/users/:id/edit
    // Need to get the ID (second to last part)
    const parts = url.pathname.split('/').filter(p => p)
    // parts = ['api', 'admin', 'users', '64bc008b-...', 'edit']
    // ID is at index parts.length - 2
    const id = parts.length >= 4 ? parts[parts.length - 2] : null
    
    const body = await request.json().catch(() => ({}))
    const { tai_khoan, mat_khau, ma_may, trang_thai } = body as {
      tai_khoan?: string
      mat_khau?: string
      ma_may?: string
      trang_thai?: string
    }

    if (!id) {
      console.error('[Dashboard API] Invalid ID from URL:', url.pathname, parts)
      return json({ error: 'Invalid id' }, 400)
    }
    
    console.log('[Dashboard API] Editing user:', { id, body })

    // Build update query dynamically
    const updates: string[] = []
    const params: any[] = []

    if (tai_khoan !== undefined) {
      updates.push('tai_khoan = ?')
      params.push(tai_khoan)
    }
    if (mat_khau !== undefined && mat_khau.trim() !== '') {
      // Lưu mật khẩu plaintext (theo yêu cầu: không mã hóa mật khẩu user đã đặt)
      updates.push('mat_khau = ?')
      params.push(mat_khau)
    }
    if (ma_may !== undefined) {
      updates.push('ma_may = ?')
      params.push(ma_may)
    }
    if (trang_thai !== undefined) {
      if (!['CHO_DUYET', 'CHO_PHEP', 'CHAN'].includes(trang_thai)) {
        return json({ error: 'Invalid status' }, 400)
      }
      
      // Check current status to see if it's actually changing
      const currentUser = await env.DB.prepare(
        'SELECT trang_thai FROM registrations WHERE id = ?'
      )
        .bind(id)
        .first<{ trang_thai: string }>()
      
      const currentStatus = currentUser?.trang_thai
      const isStatusChanging = currentStatus !== trang_thai
      
      updates.push('trang_thai = ?')
      params.push(trang_thai)
      
      // Only generate new activation key if status is changing TO CHO_PHEP
      // (not if it's already CHO_PHEP and we're just editing other fields)
      if (trang_thai === 'CHO_PHEP' && isStatusChanging) {
        updates.push('key_kich_hoat = ?')
        params.push(crypto.randomUUID())
        // V2: Set key_status='ACTIVE' when approving
        updates.push('key_status = ?')
        params.push('ACTIVE')
        console.log('[Dashboard API] Generating new activation key and setting key_status=ACTIVE for status change to CHO_PHEP')
      }
    }

    if (updates.length === 0) {
      return json({ error: 'No fields to update' }, 400)
    }

    params.push(id) // Add id at the end for WHERE clause

    const result = await env.DB.prepare(
      `UPDATE registrations 
       SET ${updates.join(', ')}
       WHERE id = ?`
    )
      .bind(...params)
      .run()

    console.log('[Dashboard API] Update result:', { 
      id, 
      success: result.success 
    })

    if (!result.success) {
      console.warn('[Dashboard API] No rows updated for id:', id)
      return json({ 
        ok: false, 
        error: 'Không tìm thấy user với ID này hoặc không có thay đổi nào' 
      }, 404)
    }

    // Log activity
    const adminInfo = getAdminInfo(request)
    const oldUser = await env.DB.prepare('SELECT tai_khoan, ma_may, trang_thai FROM registrations WHERE id = ?').bind(id).first<{ tai_khoan: string; ma_may: string; trang_thai: string }>()
    const newUser = { tai_khoan: tai_khoan || oldUser?.tai_khoan, ma_may: ma_may || oldUser?.ma_may, trang_thai: trang_thai || oldUser?.trang_thai }
    await logAdminActivity(
      env,
      'edit',
      'user',
      id,
      newUser.tai_khoan || null,
      oldUser || null,
      newUser,
      adminInfo.ip,
      adminInfo.session
    )

    return json({
      ok: true,
      message: 'Cập nhật thành công',
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error editing user:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/test-token
 * Test endpoint để kiểm tra admin token
 */
export async function testToken(request: Request, env: Env): Promise<Response> {
  const isValid = verifyAdminToken(request, env)
  return json({
    ok: isValid,
    message: isValid ? 'Token hợp lệ!' : 'Token không hợp lệ',
    hasToken: !!env.ADMIN_TOKEN,
    tokenLength: env.ADMIN_TOKEN?.length || 0,
  })
}

/**
 * Main handler cho dashboard API
 */
export async function handleDashboardAPI(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  if (pathname === '/api/admin/test-token' && request.method === 'GET') {
    return testToken(request, env)
  }

  if (pathname === '/api/admin/events' && request.method === 'GET') {
    return getEvents(request, env)
  }

  if (pathname === '/api/admin/stats' && request.method === 'GET') {
    return getStats(request, env)
  }

  if (pathname === '/api/admin/timeline' && request.method === 'GET') {
    return getTimeline(request, env)
  }

  if (pathname === '/api/admin/top-machines' && request.method === 'GET') {
    return getTopMachines(request, env)
  }

  if (pathname === '/api/admin/top-usernames' && request.method === 'GET') {
    return getTopUsernames(request, env)
  }

  if (pathname === '/api/admin/top-machines-by-usage' && request.method === 'GET') {
    return getTopMachinesByUsage(request, env)
  }

  if (pathname === '/api/admin/top-users-video-exports' && request.method === 'GET') {
    return getTopUsersVideoExports(request, env)
  }

  if (pathname === '/api/admin/users' && request.method === 'GET') {
    return getUsers(request, env)
  }

  if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/update') && request.method === 'POST') {
    return updateUserStatus(request, env)
  }

  if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/edit') && request.method === 'POST') {
    return editUser(request, env)
  }

  if (pathname.startsWith('/api/admin/users/') && request.method === 'GET') {
    const parts = pathname.split('/')
    const lastPart = parts[parts.length - 1]
    const secondLastPart = parts[parts.length - 2]
    
    // Check if it's /api/admin/users/:username/machines
    if (secondLastPart === 'users' && lastPart === 'machines') {
      const username = parts[parts.length - 2] // Get username from path
      return getUserMachines(request, env, username)
    }
    
    // Otherwise it's /api/admin/users/:id
    if (lastPart && lastPart !== 'users') {
      return getUser(request, env)
    }
  }

  if (pathname === '/api/admin/auto-block-rules' && request.method === 'GET') {
    return getAutoBlockRules(request, env)
  }

  if (pathname === '/api/admin/export/users' && request.method === 'GET') {
    return exportUsers(request, env)
  }

  if (pathname === '/api/admin/export/events' && request.method === 'GET') {
    return exportEvents(request, env)
  }

  if (pathname === '/api/admin/users/bulk-update' && request.method === 'POST') {
    return bulkUpdateUsers(request, env)
  }

  if (pathname === '/api/admin/audit-logs' && request.method === 'GET') {
    return getAuditLogs(request, env)
  }

  if (pathname === '/api/admin/activity-log' && request.method === 'GET') {
    const { getActivityLog } = await import('./activity-log-api')
    return getActivityLog(request, env)
  }

  if (pathname === '/api/admin/licenses' && request.method === 'GET') {
    return getLicenses(request, env)
  }

  if (pathname.startsWith('/api/admin/licenses/') && pathname.endsWith('/revoke') && request.method === 'POST') {
    return revokeLicense(request, env)
  }

  if (pathname.startsWith('/api/admin/licenses/') && pathname.endsWith('/regenerate') && request.method === 'POST') {
    return regenerateLicense(request, env)
  }

  return json({ error: 'Not found' }, 404)
}

/**
 * GET /api/admin/users/:username/machines
 * Lấy danh sách machine IDs của một user
 */
export async function getUserMachines(request: Request, env: Env, username: string): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    if (!username) {
      return json({ error: 'Invalid username' }, 400)
    }

    const result = await env.DB.prepare(
      `SELECT machine_id, first_seen, last_seen, request_count
       FROM machine_id_tracking
       WHERE username = ?
       ORDER BY last_seen DESC`
    )
      .bind(username)
      .all<{
        machine_id: string
        first_seen: number
        last_seen: number
        request_count: number
      }>()

    return json({
      ok: true,
      username,
      machines: result.results || [],
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting user machines:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/auto-block-rules
 * Lấy danh sách auto-block rules
 */
export async function getAutoBlockRules(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const { getAutoBlockRules } = await import('./auto-block')
    const rules = getAutoBlockRules()

    return json({
      ok: true,
      rules: rules.map(rule => ({
        eventType: rule.eventType,
        severity: rule.severity,
        threshold: rule.threshold,
        timeWindow: rule.timeWindow,
        timeWindowSeconds: rule.timeWindow / 1000,
        action: rule.action,
      })),
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting auto-block rules:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/export/users
 * Export users to CSV or JSON
 */
export async function exportUsers(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const format = url.searchParams.get('format') || 'csv' // csv or json
    const status = url.searchParams.get('status') // Optional filter
    const search = url.searchParams.get('search') // Search in tai_khoan or ma_may

    let query = `
      SELECT 
        r.id,
        r.tai_khoan,
        r.ma_may,
        r.trang_thai,
        r.thoi_gian_tao,
        r.key_kich_hoat,
        r.version,
        (SELECT COUNT(*) FROM machine_id_tracking WHERE username = r.tai_khoan) as machine_count,
        (SELECT MAX(last_seen) FROM machine_id_tracking WHERE username = r.tai_khoan) as last_active
      FROM registrations r
      WHERE 1=1
    `
    const params: any[] = []

    if (status) {
      query += ' AND r.trang_thai = ?'
      params.push(status)
    }

    if (search) {
      query += ' AND (r.tai_khoan LIKE ? OR r.ma_may LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern)
    }

    query += ' ORDER BY r.thoi_gian_tao DESC'

    const result = await env.DB.prepare(query).bind(...params).all<{
      id: string
      tai_khoan: string
      ma_may: string
      trang_thai: string
      thoi_gian_tao: number
      key_kich_hoat: string | null
      version: string | null
      machine_count: number
      last_active: number | null
    }>()

    const users = result.results || []

    if (format === 'json') {
      return new Response(JSON.stringify({ ok: true, users }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="users_${Date.now()}.json"`,
        },
      })
    }

    // CSV format
    const headers = ['ID', 'Tài Khoản', 'Mã Máy', 'Trạng Thái', 'Ngày Tạo', 'Key Kích Hoạt', 'Phiên Bản', 'Số Máy', 'Hoạt Động Cuối']
    const rows = users.map(u => [
      u.id,
      u.tai_khoan,
      u.ma_may,
      u.trang_thai,
      new Date(u.thoi_gian_tao).toISOString(),
      u.key_kich_hoat || '',
      u.version || '',
      u.machine_count.toString(),
      u.last_active ? new Date(u.last_active).toISOString() : '',
    ])

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="users_${Date.now()}.csv"`,
      },
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error exporting users:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/export/events
 * Export security events to CSV or JSON
 */
export async function exportEvents(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const format = url.searchParams.get('format') || 'csv'
    const severity = url.searchParams.get('severity')
    const eventType = url.searchParams.get('eventType')
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const since = Date.now() - hours * 60 * 60 * 1000

    let query = `
      SELECT id, event_type, severity, message, machine_id, username, 
             app_version, timestamp, metadata
      FROM security_events
      WHERE timestamp > ?
    `
    const params: any[] = [since]

    if (severity) {
      query += ' AND severity = ?'
      params.push(severity)
    }

    if (eventType) {
      query += ' AND event_type = ?'
      params.push(eventType)
    }

    query += ' ORDER BY timestamp DESC LIMIT 10000'

    const result = await env.DB.prepare(query).bind(...params).all<{
      id: string
      event_type: string
      severity: string
      message: string
      machine_id: string | null
      username: string | null
      app_version: string | null
      timestamp: number
      metadata: string | null
    }>()

    const events = result.results || []

    if (format === 'json') {
      return new Response(JSON.stringify({ ok: true, events }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="events_${Date.now()}.json"`,
        },
      })
    }

    // CSV format
    const headers = ['ID', 'Loại Sự Kiện', 'Mức Độ', 'Thông Điệp', 'Mã Máy', 'Người Dùng', 'Phiên Bản', 'Thời Gian', 'Metadata']
    const rows = events.map(e => [
      e.id,
      e.event_type,
      e.severity,
      e.message,
      e.machine_id || '',
      e.username || '',
      e.app_version || '',
      new Date(e.timestamp).toISOString(),
      e.metadata || '',
    ])

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="events_${Date.now()}.csv"`,
      },
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error exporting events:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * GET /api/admin/licenses
 * Lấy danh sách tất cả activation keys
 */
export async function getLicenses(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const search = url.searchParams.get('search')

    let query = `
      SELECT id, tai_khoan, mat_khau, ma_may, trang_thai, key_kich_hoat, thoi_gian_tao
      FROM registrations
      WHERE key_kich_hoat IS NOT NULL
    `
    const params: any[] = []

    if (search) {
      query += ' AND (tai_khoan LIKE ? OR key_kich_hoat LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern)
    }

    query += ' ORDER BY thoi_gian_tao DESC'

    const result = await env.DB.prepare(query).bind(...params).all<{
      id: string
      tai_khoan: string
      mat_khau: string | null
      ma_may: string
      trang_thai: string
      key_kich_hoat: string
      thoi_gian_tao: number
    }>()

    return json({
      ok: true,
      licenses: result.results || [],
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error getting licenses:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * POST /api/admin/licenses/:userId/revoke
 * Thu hồi activation key
 */
export async function revokeLicense(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(p => p)
    const userId = parts.length >= 4 ? parts[parts.length - 2] : null

    if (!userId) {
      return json({ error: 'Invalid user id' }, 400)
    }

    // Get user info before revoking
    const user = await env.DB.prepare('SELECT tai_khoan, key_kich_hoat FROM registrations WHERE id = ?')
      .bind(userId)
      .first<{ tai_khoan: string; key_kich_hoat: string | null }>()

    if (!user) {
      return json({ error: 'User not found' }, 404)
    }

    // Revoke key
    const result = await env.DB.prepare('UPDATE registrations SET key_kich_hoat = NULL WHERE id = ?')
      .bind(userId)
      .run()

    // Log activity
    const adminInfo = getAdminInfo(request)
    await logAdminActivity(
      env,
      'revoke_key',
      'license',
      userId,
      user.tai_khoan,
      { key_kich_hoat: user.key_kich_hoat },
      { key_kich_hoat: null },
      adminInfo.ip,
      adminInfo.session
    )

    return json({
      ok: true,
      message: 'Thu hồi key thành công',
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error revoking license:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * POST /api/admin/licenses/:userId/regenerate
 * Tạo lại activation key
 */
export async function regenerateLicense(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(p => p)
    const userId = parts.length >= 4 ? parts[parts.length - 2] : null

    if (!userId) {
      return json({ error: 'Invalid user id' }, 400)
    }

    // Get user info before regenerating
    const user = await env.DB.prepare('SELECT tai_khoan, key_kich_hoat FROM registrations WHERE id = ?')
      .bind(userId)
      .first<{ tai_khoan: string; key_kich_hoat: string | null }>()

    if (!user) {
      return json({ error: 'User not found' }, 404)
    }

    // Generate new key
    const newKey = crypto.randomUUID()
    // V2: Set key_status='ACTIVE' when regenerating key
    const result = await env.DB.prepare('UPDATE registrations SET key_kich_hoat = ?, key_status = ? WHERE id = ?')
      .bind(newKey, 'ACTIVE', userId)
      .run()

    // Log activity
    const adminInfo = getAdminInfo(request)
    await logAdminActivity(
      env,
      'regenerate_key',
      'license',
      userId,
      user.tai_khoan,
      { key_kich_hoat: user.key_kich_hoat },
      { key_kich_hoat: newKey },
      adminInfo.ip,
      adminInfo.session
    )

    return json({
      ok: true,
      message: 'Tạo lại key thành công',
      key_kich_hoat: newKey,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error regenerating license:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

/**
 * POST /api/admin/users/bulk-update
 * Bulk update user statuses
 */
export async function bulkUpdateUsers(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminToken(request, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { userIds, status } = body as { userIds?: string[]; status?: string }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return json({ error: 'userIds is required and must be a non-empty array' }, 400)
    }

    if (!status || !['CHO_DUYET', 'CHO_PHEP', 'CHAN'].includes(status)) {
      return json({ error: 'status must be CHO_DUYET, CHO_PHEP, or CHAN' }, 400)
    }

    let key_kich_hoat: string | null = null
    if (status === 'CHO_PHEP') {
      // Generate keys for all users being approved
      key_kich_hoat = crypto.randomUUID()
    }

    // Update all users
    const placeholders = userIds.map(() => '?').join(',')
    const params = status === 'CHO_PHEP' 
      ? [status, key_kich_hoat, 'ACTIVE', ...userIds]
      : [status, ...userIds]

    // V2: Set key_status='ACTIVE' when bulk approving
    const query = status === 'CHO_PHEP'
      ? `UPDATE registrations SET trang_thai = ?, key_kich_hoat = ?, key_status = ? WHERE id IN (${placeholders})`
      : `UPDATE registrations SET trang_thai = ? WHERE id IN (${placeholders})`

    const result = await env.DB.prepare(query).bind(...params).run()

    // Log activity
    const adminInfo = getAdminInfo(request)
    const actionType = status === 'CHO_PHEP' ? 'bulk_approve' : status === 'CHAN' ? 'bulk_block' : 'bulk_unblock'
    await logAdminActivity(
      env,
      actionType,
      'user',
      null,
      `${userIds.length} users`,
      null,
      { status, userIds, count: userIds.length },
      adminInfo.ip,
      adminInfo.session
    )

    return json({
      ok: true,
      message: `Đã cập nhật ${userIds.length} người dùng`,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error bulk updating users:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}

