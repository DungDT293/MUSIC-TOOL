-- Database Schema cho Admin Activity Log
-- Dùng cho Cloudflare D1 Database

-- Tạo table admin_activity_log
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL, -- 'approve', 'block', 'unblock', 'edit', 'bulk_update', 'revoke_key', 'regenerate_key'
  target_type TEXT NOT NULL, -- 'user', 'license', 'system'
  target_id TEXT, -- user_id hoặc license key
  target_name TEXT, -- username hoặc identifier
  old_value TEXT, -- JSON string của giá trị cũ
  new_value TEXT, -- JSON string của giá trị mới
  admin_ip TEXT, -- IP address của admin
  admin_session TEXT, -- Session identifier
  timestamp INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_timestamp ON admin_activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action_type ON admin_activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_target_type ON admin_activity_log(target_type);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_target_id ON admin_activity_log(target_id);


