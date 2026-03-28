-- Migration: Auth Flow V2 - Production Grade
-- Date: 2026-01-22
-- Description: Add key_status, tokens, audit_logs for V2 authentication flow

-- ============================================
-- 1. Add new columns to registrations table
-- ============================================

-- Add key_status column (PENDING | ACTIVE | LOCKED | REVOKED)
-- Check if column exists before adding (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)
-- Note: This migration assumes SQLite (Cloudflare D1), adjust syntax if using other DB

-- For SQLite/D1, we need to check if column exists first
-- Since D1 doesn't support IF NOT EXISTS for ALTER TABLE, we'll handle this in application code

-- Add key_status
-- ALTER TABLE registrations ADD COLUMN key_status TEXT DEFAULT 'PENDING';

-- Add key_attempts
-- ALTER TABLE registrations ADD COLUMN key_attempts INTEGER DEFAULT 0;

-- Add key_locked_at
-- ALTER TABLE registrations ADD COLUMN key_locked_at INTEGER;

-- Add last_key_attempt_at
-- ALTER TABLE registrations ADD COLUMN last_key_attempt_at INTEGER;

-- Add device_token
-- ALTER TABLE registrations ADD COLUMN device_token TEXT;

-- Add device_token_expires_at
-- ALTER TABLE registrations ADD COLUMN device_token_expires_at INTEGER;

-- Add refresh_token
-- ALTER TABLE registrations ADD COLUMN refresh_token TEXT;

-- Add refresh_token_expires_at
-- ALTER TABLE registrations ADD COLUMN refresh_token_expires_at INTEGER;

-- Add last_login_at
-- ALTER TABLE registrations ADD COLUMN last_login_at INTEGER;

-- Add last_login_ip
-- ALTER TABLE registrations ADD COLUMN last_login_ip TEXT;

-- ============================================
-- 2. Create auth_audit_logs table
-- ============================================

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  event_type TEXT NOT NULL, -- REGISTER | APPROVE | KEY_VALIDATE | KEY_FAIL | KEY_LOCK | KEY_REVOKE | LOGIN | LOGOUT | TAMPER | MACHINE_REBIND
  severity TEXT DEFAULT 'info', -- info | warning | error | critical
  ip_address TEXT,
  machine_id TEXT,
  details TEXT, -- JSON string
  timestamp INTEGER NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_auth_audit_username ON auth_audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event_type ON auth_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_timestamp ON auth_audit_logs(timestamp);

-- ============================================
-- 3. Update existing registrations
-- ============================================

-- Set default key_status for existing records
-- UPDATE registrations SET key_status = 'PENDING' WHERE key_status IS NULL;
-- UPDATE registrations SET key_attempts = 0 WHERE key_attempts IS NULL;

-- For existing approved accounts, set key_status to ACTIVE if they have key_kich_hoat
-- UPDATE registrations 
-- SET key_status = 'ACTIVE' 
-- WHERE trang_thai = 'CHO_PHEP' AND key_kich_hoat IS NOT NULL AND key_status IS NULL;
