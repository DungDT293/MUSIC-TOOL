-- Database Schema cho Security Events
-- Dùng cho Cloudflare D1 Database

-- Tạo table security_events
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  details TEXT, -- JSON string
  timestamp INTEGER NOT NULL,
  machine_id TEXT NOT NULL,
  username TEXT,
  app_version TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_security_events_machine_id ON security_events(machine_id);
CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON security_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);

-- View để xem events gần đây (24h)
CREATE VIEW IF NOT EXISTS recent_security_events AS
SELECT 
  event_type,
  severity,
  message,
  machine_id,
  username,
  timestamp,
  created_at
FROM security_events
WHERE timestamp > (strftime('%s', 'now') * 1000 - 24 * 60 * 60 * 1000)
ORDER BY timestamp DESC;

-- View để thống kê events theo machine_id
CREATE VIEW IF NOT EXISTS security_events_by_machine AS
SELECT 
  machine_id,
  COUNT(*) as event_count,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
  COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
  MAX(timestamp) as last_event_time
FROM security_events
GROUP BY machine_id
ORDER BY event_count DESC;


