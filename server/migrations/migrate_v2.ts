/**
 * Migration Script: Auth Flow V2
 * 
 * This script migrates the database schema to support V2 authentication flow:
 * - Adds new columns to registrations table
 * - Creates auth_audit_logs table
 * - Updates existing data
 * 
 * Usage: Run this script once when deploying V2
 */

interface Env {
  DB?: D1Database
  ADMIN_TOKEN?: string
}

/**
 * Check if a column exists in a table (SQLite/D1)
 */
async function columnExists(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
  try {
    const result = await db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all<{ name: string }>()
    
    if (!result.results) return false
    
    return result.results.some((row) => row.name === columnName)
  } catch (err) {
    console.error(`[Migration] Error checking column ${columnName} in ${tableName}:`, err)
    return false
  }
}

/**
 * Add column if it doesn't exist
 */
async function addColumnIfNotExists(
  db: D1Database,
  tableName: string,
  columnName: string,
  columnDef: string
): Promise<void> {
  const exists = await columnExists(db, tableName, columnName)
  if (exists) {
    console.log(`[Migration] Column ${tableName}.${columnName} already exists, skipping`)
    return
  }

  try {
    await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run()
    console.log(`[Migration] Added column ${tableName}.${columnName}`)
  } catch (err) {
    console.error(`[Migration] Error adding column ${tableName}.${columnName}:`, err)
    throw err
  }
}

/**
 * Check if table exists
 */
async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  try {
    const result = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .bind(tableName)
      .first<{ name: string }>()
    
    return result !== null
  } catch (err) {
    console.error(`[Migration] Error checking table ${tableName}:`, err)
    return false
  }
}

/**
 * Main migration function
 */
export async function migrateToV2(env: Env): Promise<{ success: boolean; message: string }> {
  if (!env.DB) {
    return { success: false, message: 'Database not available' }
  }

  try {
    console.log('[Migration] Starting Auth Flow V2 migration...')

    // ============================================
    // 1. Add new columns to registrations table
    // ============================================
    console.log('[Migration] Adding columns to registrations table...')

    await addColumnIfNotExists(env.DB, 'registrations', 'key_status', "TEXT DEFAULT 'PENDING'")
    await addColumnIfNotExists(env.DB, 'registrations', 'key_attempts', 'INTEGER DEFAULT 0')
    await addColumnIfNotExists(env.DB, 'registrations', 'key_locked_at', 'INTEGER')
    await addColumnIfNotExists(env.DB, 'registrations', 'last_key_attempt_at', 'INTEGER')
    await addColumnIfNotExists(env.DB, 'registrations', 'device_token', 'TEXT')
    await addColumnIfNotExists(env.DB, 'registrations', 'device_token_expires_at', 'INTEGER')
    await addColumnIfNotExists(env.DB, 'registrations', 'refresh_token', 'TEXT')
    await addColumnIfNotExists(env.DB, 'registrations', 'refresh_token_expires_at', 'INTEGER')
    await addColumnIfNotExists(env.DB, 'registrations', 'last_login_at', 'INTEGER')
    await addColumnIfNotExists(env.DB, 'registrations', 'last_login_ip', 'TEXT')
    // V3: License expiry — NULL = vĩnh viễn (user cũ không bị ảnh hưởng)
    await addColumnIfNotExists(env.DB, 'registrations', 'license_expires_at', 'INTEGER')

    // ============================================
    // 2. Create auth_audit_logs table
    // ============================================
    console.log('[Migration] Creating auth_audit_logs table...')

    const auditTableExists = await tableExists(env.DB, 'auth_audit_logs')
    if (!auditTableExists) {
      await env.DB.prepare(`
        CREATE TABLE auth_audit_logs (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          event_type TEXT NOT NULL,
          severity TEXT DEFAULT 'info',
          ip_address TEXT,
          machine_id TEXT,
          details TEXT,
          timestamp INTEGER NOT NULL
        )
      `).run()

      // Create indexes
      await env.DB.prepare(`CREATE INDEX idx_auth_audit_username ON auth_audit_logs(username)`).run()
      await env.DB.prepare(`CREATE INDEX idx_auth_audit_event_type ON auth_audit_logs(event_type)`).run()
      await env.DB.prepare(`CREATE INDEX idx_auth_audit_timestamp ON auth_audit_logs(timestamp)`).run()

      console.log('[Migration] Created auth_audit_logs table with indexes')
    } else {
      console.log('[Migration] auth_audit_logs table already exists, skipping')
    }

    // ============================================
    // 3. Update existing registrations
    // ============================================
    console.log('[Migration] Updating existing registrations...')

    // Set default key_status for existing records
    await env.DB.prepare(`
      UPDATE registrations 
      SET key_status = 'PENDING' 
      WHERE key_status IS NULL
    `).run()

    // Set default key_attempts
    await env.DB.prepare(`
      UPDATE registrations 
      SET key_attempts = 0 
      WHERE key_attempts IS NULL
    `).run()

    // For existing approved accounts, set key_status to ACTIVE if they have key_kich_hoat
    await env.DB.prepare(`
      UPDATE registrations 
      SET key_status = 'ACTIVE' 
      WHERE trang_thai = 'CHO_PHEP' 
        AND key_kich_hoat IS NOT NULL 
        AND (key_status IS NULL OR key_status = 'PENDING')
    `).run()

    console.log('[Migration] Updated existing registrations')

    console.log('[Migration] ✅ Migration completed successfully!')
    return { success: true, message: 'Migration completed successfully' }
  } catch (err: any) {
    console.error('[Migration] ❌ Migration failed:', err)
    return { success: false, message: err?.message || String(err) }
  }
}

/**
 * Migration endpoint for Cloudflare Workers
 * Call this endpoint once to run migration
 */
export async function handleMigration(request: Request, env: Env): Promise<Response> {
  // SECURITY: Require admin token
  const adminToken = request.headers.get('x-admin-token')
  
  // Trim both tokens to avoid whitespace issues
  const receivedToken = adminToken?.trim() || ''
  const expectedToken = (env.ADMIN_TOKEN || '').trim()
  
  // Debug logging (remove in production)
  console.log('[Migration] Received admin token length:', receivedToken.length)
  console.log('[Migration] Expected token length:', expectedToken.length)
  console.log('[Migration] Tokens match:', receivedToken === expectedToken)
  
  if (!adminToken || receivedToken !== expectedToken) {
    console.log('[Migration] Token mismatch!')
    return new Response(JSON.stringify({ error: 'Admin token required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, message: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const result = await migrateToV2(env)
  
  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
