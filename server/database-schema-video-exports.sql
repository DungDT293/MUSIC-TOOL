-- Database Schema cho Video Exports Tracking
-- Dùng để theo dõi số video mà mỗi người dùng đã xuất thành công/thất bại

-- Tạo table video_exports
CREATE TABLE IF NOT EXISTS video_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
  error_message TEXT, -- Lưu lỗi nếu status = 'failed'
  video_duration INTEGER, -- Thời lượng video (giây)
  file_size INTEGER, -- Kích thước file (bytes)
  export_format TEXT, -- mp4, mov, etc.
  timestamp INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_video_exports_username ON video_exports(username);
CREATE INDEX IF NOT EXISTS idx_video_exports_machine_id ON video_exports(machine_id);
CREATE INDEX IF NOT EXISTS idx_video_exports_status ON video_exports(status);
CREATE INDEX IF NOT EXISTS idx_video_exports_timestamp ON video_exports(timestamp);

-- View để thống kê video exports theo username
CREATE VIEW IF NOT EXISTS video_exports_stats_by_user AS
SELECT 
  username,
  COUNT(*) as total_exports,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  MAX(timestamp) as last_export_time
FROM video_exports
GROUP BY username
ORDER BY total_exports DESC;











