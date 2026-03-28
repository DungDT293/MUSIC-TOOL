-- Migration: Version Policy Table
-- Date: 2026-01-22
-- Description: Create version_policy table for auto-update version gating

-- ============================================
-- Create version_policy table
-- ============================================

CREATE TABLE IF NOT EXISTS version_policy (
  id TEXT PRIMARY KEY DEFAULT 'global',
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_version_policy_id ON version_policy(id);

-- Insert default policy
INSERT OR IGNORE INTO version_policy (id, policy_json, updated_at)
VALUES (
  'global',
  '{"latest_version":"3.6.0","min_supported_version":"3.6.0","blocked_versions":[],"recommended_version":"3.6.0","recommended_installer_url":"","force_update":false,"message":""}',
  ?1
);
