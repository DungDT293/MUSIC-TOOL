/**
 * GET /api/version-policy — public, no auth required
 * POST /api/admin/version-policy/update — admin only
 */

import { json } from '../utils/json'
import { DEFAULT_VERSION_POLICY } from '../env'
import type { Env } from '../env'
import { validatePayload } from '../../backend/utils/validatePayload'
import { VersionPolicySchema, ServerUpdateVersionPolicySchema } from '../../shared/ipcSchemas'

export async function handleVersionPolicy(request: Request, env: Env): Promise<Response> {
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
      const defaultPolicy = { ...DEFAULT_VERSION_POLICY }
      return json(defaultPolicy)
    }

    const row = await env.DB.prepare(
      'SELECT policy_json FROM version_policy WHERE id = ?'
    )
      .bind('global')
      .first<{ policy_json: string }>()

    if (!row) {
      // Return default policy if not found
      const defaultPolicy = { ...DEFAULT_VERSION_POLICY }
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
      const defaultPolicy = { ...DEFAULT_VERSION_POLICY }
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
      const defaultPolicy = { ...DEFAULT_VERSION_POLICY }
      return json(defaultPolicy)
    }
  } catch (err: any) {
    console.error('[handleVersionPolicy] Error:', err)
    // Return default policy on error (fail-open)
    const defaultPolicy = { ...DEFAULT_VERSION_POLICY }
    return json(defaultPolicy)
  }
}

export async function handleUpdateVersionPolicy(request: Request, env: Env): Promise<Response> {
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
