/**
 * Migration Script: Version Policy
 * 
 * This script creates the version_policy table for auto-update version gating
 * 
 * Usage: Run this script once when deploying auto-update feature
 */

interface Env {
  DB?: D1Database
  ADMIN_TOKEN?: string
}

/**
 * Check if a table exists
 */
async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  try {
    const result = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .bind(tableName)
      .first<{ name: string }>()
    return !!result
  } catch (err) {
    console.error(`[Migration] Error checking table ${tableName}:`, err)
    return false
  }
}

/**
 * Migrate to version policy schema
 */
export async function migrateVersionPolicy(env: Env): Promise<void> {
  if (!env.DB) {
    console.error('[Migration] Database not available')
    return
  }

  try {
    // Check if table exists
    const exists = await tableExists(env.DB, 'version_policy')
    
    if (!exists) {
      console.log('[Migration] Creating version_policy table...')
      
      await env.DB.prepare(`
        CREATE TABLE version_policy (
          id TEXT PRIMARY KEY DEFAULT 'global',
          policy_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run()
      
      await env.DB.prepare(`CREATE INDEX idx_version_policy_id ON version_policy(id)`).run()
      
      // Insert default policy
      const defaultPolicy = {
        latest_version: '4.1.0',
        min_supported_version: '4.1.0',
        blocked_versions: [],
        recommended_version: '4.1.0',
        recommended_installer_url: '',
        force_update: false,
        message: ''
      }
      
      await env.DB.prepare(`
        INSERT INTO version_policy (id, policy_json, updated_at)
        VALUES ('global', ?1, ?2)
      `)
        .bind(JSON.stringify(defaultPolicy), Date.now())
        .run()
      
      console.log('[Migration] Created version_policy table with default policy')
    } else {
      console.log('[Migration] version_policy table already exists, skipping')
    }
  } catch (err) {
    console.error('[Migration] Error migrating version_policy:', err)
    throw err
  }
}
