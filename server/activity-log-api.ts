/// <reference path="./types.d.ts" />

interface Env {
  DB?: D1Database
  ADMIN_TOKEN?: string
}

import { verifyAdminRequest } from './admin-auth'

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Log admin activity
 */
export async function logAdminActivity(
  env: Env,
  actionType: string,
  targetType: string,
  targetId: string | null,
  targetName: string | null,
  oldValue: any,
  newValue: any,
  adminIp: string | null,
  adminSession: string | null
): Promise<void> {
  if (!env.DB) return

  try {
    await env.DB.prepare(
      `INSERT INTO admin_activity_log 
       (action_type, target_type, target_id, target_name, old_value, new_value, admin_ip, admin_session, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        actionType,
        targetType,
        targetId,
        targetName,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        adminIp,
        adminSession,
        Date.now()
      )
      .run()
  } catch (error: any) {
    console.error('[Activity Log] Error logging activity:', error)
  }
}

/**
 * GET /api/admin/activity-log
 * Lấy lịch sử hoạt động của admin
 */
export async function getActivityLog(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.substring(7)
  if (token !== env.ADMIN_TOKEN && !(await verifyAdminRequest(request, env))) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!env.DB) {
    return json({ error: 'Database not available' }, 500)
  }

  try {
    const url = new URL(request.url)
    const actionType = url.searchParams.get('actionType')
    const targetType = url.searchParams.get('targetType')
    const hours = parseInt(url.searchParams.get('hours') || '24', 10)
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
    const since = Date.now() - hours * 60 * 60 * 1000

    let query = `
      SELECT id, action_type, target_type, target_id, target_name, 
             old_value, new_value, admin_ip, admin_session, timestamp
      FROM admin_activity_log
      WHERE timestamp > ?
    `
    const params: any[] = [since]

    if (actionType) {
      query += ' AND action_type = ?'
      params.push(actionType)
    }

    if (targetType) {
      query += ' AND target_type = ?'
      params.push(targetType)
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await env.DB.prepare(query).bind(...params).all<{
      id: number
      action_type: string
      target_type: string
      target_id: string | null
      target_name: string | null
      old_value: string | null
      new_value: string | null
      admin_ip: string | null
      admin_session: string | null
      timestamp: number
    }>()

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM admin_activity_log WHERE timestamp > ?'
    const countParams: any[] = [since]
    if (actionType) {
      countQuery += ' AND action_type = ?'
      countParams.push(actionType)
    }
    if (targetType) {
      countQuery += ' AND target_type = ?'
      countParams.push(targetType)
    }
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>()

    return json({
      ok: true,
      activities: (result.results || []).map(a => ({
        ...a,
        old_value: a.old_value ? JSON.parse(a.old_value) : null,
        new_value: a.new_value ? JSON.parse(a.new_value) : null,
      })),
      total: countResult?.total || 0,
    })
  } catch (error: any) {
    console.error('[Activity Log API] Error getting activity log:', error)
    return json({ error: error.message || 'Internal error' }, 500)
  }
}
