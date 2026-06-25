/// <reference path="./types.d.ts" />

import { json } from './utils/json'

export interface AdminAuthEnv {
  DB?: D1Database
  ADMIN_TOKEN?: string
  OWNER_EMAIL?: string
  OWNER_PASSWORD_HASH?: string
}

export interface AdminSession {
  id: string
  email: string
  role: string
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getClientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    null
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim()
  const adminHeader = request.headers.get('x-admin-token')
  return adminHeader?.trim() || null
}

async function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt || crypto.getRandomValues(new Uint8Array(16))
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const saltBuffer = new ArrayBuffer(saltBytes.length)
  new Uint8Array(saltBuffer).set(saltBytes)
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuffer, iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    256
  )
  return {
    hash: btoa(String.fromCharCode(...new Uint8Array(hashBuffer))),
    salt: btoa(String.fromCharCode(...saltBytes)),
  }
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [storedHash, storedSalt] = stored.split(':')
  if (!storedHash || !storedSalt) return false
  const saltBytes = Uint8Array.from(atob(storedSalt), (c) => c.charCodeAt(0))
  const { hash } = await hashPassword(password, saltBytes)
  return hash === storedHash
}

async function ensureAdminTables(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      created_by TEXT,
      last_login_at INTEGER
    )
  `).run()

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      ip TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (admin_id) REFERENCES admin_accounts(id)
    )
  `).run()

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_accounts_email ON admin_accounts(email)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id)').run()
}

async function seedOwnerIfNeeded(db: D1Database, env: AdminAuthEnv, email: string, password: string): Promise<void> {
  const ownerEmail = env.OWNER_EMAIL?.trim().toLowerCase()
  const ownerPasswordHash = env.OWNER_PASSWORD_HASH
  if (!ownerEmail || !ownerPasswordHash || ownerEmail !== email) return

  const count = await db.prepare('SELECT COUNT(*) as total FROM admin_accounts')
    .first<{ total: number }>()
  if ((count?.total || 0) > 0) return

  if (!(await verifyPassword(password, ownerPasswordHash))) return

  const now = Date.now()
  await db.prepare(
    `INSERT INTO admin_accounts (id, email, password_hash, role, status, created_at, created_by)
     VALUES (?1, ?2, ?3, 'owner', 'active', ?4, 'bootstrap')`
  )
    .bind(crypto.randomUUID(), ownerEmail, ownerPasswordHash, now)
    .run()
}

export async function verifyAdminRequest(request: Request, env: AdminAuthEnv): Promise<AdminSession | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) {
    return { id: 'legacy-admin-token', email: 'legacy-admin-token', role: 'owner' }
  }

  if (!env.DB) return null
  await ensureAdminTables(env.DB)

  const row = await env.DB.prepare(
    `SELECT s.id, s.expires_at, a.email, a.role, a.status
     FROM admin_sessions s
     JOIN admin_accounts a ON a.id = s.admin_id
     WHERE s.token = ?1
     LIMIT 1`
  )
    .bind(token)
    .first<{ id: string; expires_at: number; email: string; role: string; status: string }>()

  if (!row || row.status !== 'active' || row.expires_at < Date.now()) {
    return null
  }

  return { id: row.id, email: row.email, role: row.role }
}

export async function handleAdminLogin(request: Request, env: AdminAuthEnv): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database not available' }, 500)

  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null
  const email = body?.email?.trim().toLowerCase()
  const password = body?.password || ''
  if (!email || !password) {
    return json({ ok: false, error: 'Email and password are required' }, 400)
  }

  await ensureAdminTables(env.DB)
  await seedOwnerIfNeeded(env.DB, env, email, password)

  const admin = await env.DB.prepare(
    `SELECT id, email, password_hash, role, status
     FROM admin_accounts
     WHERE lower(email) = ?1
     LIMIT 1`
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; role: string; status: string }>()

  if (!admin || admin.status !== 'active' || !(await verifyPassword(password, admin.password_hash))) {
    if (admin?.status === 'pending') {
      return json({ ok: false, error: 'Tai khoan admin dang cho owner duyet.' }, 403)
    }
    if (admin?.status === 'disabled') {
      return json({ ok: false, error: 'Tai khoan admin da bi khoa.' }, 403)
    }
    return json({ ok: false, error: 'Email hoac mat khau khong dung.' }, 401)
  }

  const token = crypto.randomUUID() + '.' + crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS
  await env.DB.prepare(
    `INSERT INTO admin_sessions (id, admin_id, token, ip, user_agent, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(
      crypto.randomUUID(),
      admin.id,
      token,
      getClientIp(request),
      request.headers.get('User-Agent'),
      now,
      expiresAt
    )
    .run()

  await env.DB.prepare('UPDATE admin_accounts SET last_login_at = ?1 WHERE id = ?2')
    .bind(now, admin.id)
    .run()

  return json({
    ok: true,
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    },
    expires_at: expiresAt,
  })
}

export async function handleAdminMe(request: Request, env: AdminAuthEnv): Promise<Response> {
  const session = await verifyAdminRequest(request, env)
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401)
  return json({ ok: true, admin: session })
}

async function requireOwner(request: Request, env: AdminAuthEnv): Promise<AdminSession | null> {
  const session = await verifyAdminRequest(request, env)
  return session?.role === 'owner' ? session : null
}

export async function handleAdminAccounts(request: Request, env: AdminAuthEnv): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database not available' }, 500)
  if (!(await requireOwner(request, env))) return json({ ok: false, error: 'Owner required' }, 403)

  await ensureAdminTables(env.DB)
  const result = await env.DB.prepare(
    `SELECT a.id, a.email, a.role, a.status, a.created_at, a.created_by, a.last_login_at,
      (SELECT COUNT(*) FROM admin_sessions s WHERE s.admin_id = a.id) as session_count
     FROM admin_accounts a
     ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, a.created_at DESC`
  ).all()
  return json({ ok: true, admins: result.results || [] })
}

export async function handleAdminCreate(request: Request, env: AdminAuthEnv): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database not available' }, 500)
  const owner = await requireOwner(request, env)
  if (!owner) return json({ ok: false, error: 'Owner required' }, 403)

  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null
  const email = body?.email?.trim().toLowerCase()
  const password = body?.password || ''
  if (!email || !password) return json({ ok: false, error: 'Email and password are required' }, 400)
  if (password.length < 8) return json({ ok: false, error: 'Mat khau toi thieu 8 ky tu.' }, 400)

  await ensureAdminTables(env.DB)
  const existing = await env.DB.prepare('SELECT id FROM admin_accounts WHERE lower(email) = ?1')
    .bind(email)
    .first<{ id: string }>()
  if (existing) return json({ ok: false, error: 'Email nay da ton tai.' }, 409)

  const { hash, salt } = await hashPassword(password)
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO admin_accounts (id, email, password_hash, role, status, created_at, created_by)
     VALUES (?1, ?2, ?3, 'admin', 'active', ?4, ?5)`
  )
    .bind(id, email, `${hash}:${salt}`, Date.now(), owner.email)
    .run()

  return json({ ok: true, admin: { id, email, role: 'admin', status: 'active' } })
}

export async function handleAdminAccountAction(request: Request, env: AdminAuthEnv): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database not available' }, 500)
  if (!(await requireOwner(request, env))) return json({ ok: false, error: 'Owner required' }, 403)

  await ensureAdminTables(env.DB)
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[3]
  const action = parts[4]
  if (!id || !action) return json({ ok: false, error: 'Invalid admin action' }, 400)

  const target = await env.DB.prepare('SELECT id, email, role, status FROM admin_accounts WHERE id = ?1')
    .bind(id)
    .first<{ id: string; email: string; role: string; status: string }>()
  if (!target) return json({ ok: false, error: 'Admin not found' }, 404)
  if (target.role === 'owner' && (action === 'delete' || action === 'disable')) {
    return json({ ok: false, error: 'Khong the khoa/xoa owner.' }, 400)
  }

  if (action === 'approve') {
    await env.DB.prepare("UPDATE admin_accounts SET status = 'active', role = 'admin' WHERE id = ?1").bind(id).run()
  } else if (action === 'disable') {
    await env.DB.prepare("UPDATE admin_accounts SET status = 'disabled' WHERE id = ?1").bind(id).run()
    await env.DB.prepare('UPDATE admin_sessions SET revoked_at = ?1 WHERE admin_id = ?2 AND revoked_at IS NULL').bind(Date.now(), id).run()
  } else if (action === 'enable') {
    await env.DB.prepare("UPDATE admin_accounts SET status = 'active' WHERE id = ?1").bind(id).run()
  } else if (action === 'delete') {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_id = ?1').bind(id).run()
    await env.DB.prepare('DELETE FROM admin_accounts WHERE id = ?1').bind(id).run()
  } else {
    return json({ ok: false, error: 'Unsupported action' }, 400)
  }

  return json({ ok: true, message: 'Admin updated' })
}
