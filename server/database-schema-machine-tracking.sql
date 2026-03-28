-- Database Schema cho Machine ID Tracking
-- Dùng để track machineIds theo username, phát hiện account sharing

-- Tạo table machine_id_tracking
CREATE TABLE IF NOT EXISTS machine_id_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  request_count INTEGER DEFAULT 1,
  UNIQUE(username, machine_id)
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_machine_tracking_username ON machine_id_tracking(username);
CREATE INDEX IF NOT EXISTS idx_machine_tracking_machine_id ON machine_id_tracking(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_tracking_last_seen ON machine_id_tracking(last_seen);

-- View để xem số lượng machineIds theo username
CREATE VIEW IF NOT EXISTS machine_count_by_username AS
SELECT 
  username,
  COUNT(*) as machine_count,
  MAX(last_seen) as last_activity,
  SUM(request_count) as total_requests
FROM machine_id_tracking
GROUP BY username
HAVING machine_count > 1
ORDER BY machine_count DESC;

-- View để xem các machineIds của một username
CREATE VIEW IF NOT EXISTS machines_by_username AS
SELECT 
  username,
  machine_id,
  first_seen,
  last_seen,
  request_count,
  (strftime('%s', 'now') * 1000 - last_seen) as inactive_ms
FROM machine_id_tracking
ORDER BY username, last_seen DESC;


