/**
 * POST /api/video/export — Track video export events
 */

import { json } from '../utils/json'
import type { Env } from '../env'
import { requireRateLimit, getIdentifierFromRequest, RateLimitPresets } from '../../backend/security/rateLimiter'
import { validatePayload } from '../../backend/utils/validatePayload'
import { ServerVideoExportSchema } from '../../shared/ipcSchemas'

export async function handleVideoExport(request: Request, env: Env): Promise<Response> {
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
