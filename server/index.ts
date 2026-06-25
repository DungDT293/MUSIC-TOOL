/// <reference path="./types.d.ts" />

/**
 * Cloudflare Workers - License Server với Security Features
 * Main entry point — Router only (handlers tách riêng)
 */

import type { Env } from './env'
import { json } from './utils/json'
import { verifyRequestSignature } from './security-verification'
import { handleSecurityReport } from './security-report-endpoint'
import { handleDashboardAPI } from './dashboard-api'
import { handleMigration } from './migrations/migrate_v2'
import { handleRegister } from './handlers/register'
import { handleCheck } from './handlers/check'
import { handleVideoExport } from './handlers/video-export'
import { handleAdminUpdate } from './handlers/admin-update'
import { handleVersionPolicy, handleUpdateVersionPolicy } from './handlers/version-policy'
import { serveDashboard } from './dashboard/serve'

// Re-export json for backward compatibility (dashboard-api.ts imports from './index')
export { json }
// Re-export Env type
export type { Env }

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
      const publicRoutes = ['/api/security/report', '/dashboard', '/', '/api/video/export', '/api/version-policy', '/api/migrate/v2']
      const isDashboardAPI = pathname.startsWith('/api/admin/')
      const isAdminAuthRoute = pathname.startsWith('/api/auth/admin/')

      // Parse request body once for routes that need signature verification
      let parsedBody: any = null
      if (!publicRoutes.includes(pathname) && !isDashboardAPI && !isAdminAuthRoute) {
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
            env,
            { trustedSource: true },
          ).catch(() => {}) // Ignore errors khi report

          return json({ error: 'Invalid request signature' }, 401)
        }
      }

      // ============================================
      // ROUTES
      // ============================================

      // Auth routes
      if (pathname === '/api/auth/register' && request.method === 'POST') {
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
