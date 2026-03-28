-- Migration: Add mat_khau column to registrations table
-- Run this in Cloudflare D1 Database console if the column doesn't exist

-- Check if column exists, if not add it
-- Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- So we need to check manually or just try to add it (it will fail silently if exists in some SQLite versions)

ALTER TABLE registrations ADD COLUMN mat_khau TEXT;

-- Verify the column was added
-- SELECT sql FROM sqlite_master WHERE type='table' AND name='registrations';











