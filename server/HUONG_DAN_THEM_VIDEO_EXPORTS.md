# Hướng Dẫn Thêm Bảng Video Exports vào Database

## Mục đích
Theo dõi số video mà mỗi người dùng đã xuất thành công/thất bại.

## Bước 1: Tạo bảng video_exports trong Cloudflare D1

1. Truy cập Cloudflare Dashboard → Workers & Pages → D1 → SQL Editor
2. Chạy SQL script sau:

```sql
-- Tạo table video_exports
CREATE TABLE IF NOT EXISTS video_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
  error_message TEXT,
  video_duration INTEGER,
  file_size INTEGER,
  export_format TEXT,
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
```

## Bước 2: Kiểm tra bảng đã được tạo

Chạy query sau để kiểm tra:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='video_exports';
```

Nếu có kết quả, bảng đã được tạo thành công.

## Bước 3: Client App gửi thông tin xuất video

Khi client app xuất video thành công hoặc thất bại, gửi POST request đến:

```
POST https://license-server.dungdong333.workers.dev/api/video/export
Content-Type: application/json

{
  "username": "hungmay4",
  "machine_id": "c909c065185b0ffbaaaa7a0b0e7793e3cc67821b390dd316904033633567ce7f",
  "status": "success",  // hoặc "failed"
  "error_message": null,  // chỉ có khi status = "failed"
  "video_duration": 120,  // tùy chọn: thời lượng video (giây)
  "file_size": 10485760,  // tùy chọn: kích thước file (bytes)
  "export_format": "mp4"  // tùy chọn: định dạng video
}
```

## Bước 4: Xem thống kê trong Dashboard

Sau khi deploy, vào Dashboard → Quản Lý Người Dùng, bạn sẽ thấy cột "Video Xuất" hiển thị:
- ✓ [số thành công] ✗ [số thất bại]
- Tổng: [tổng số video]

## Lưu ý

- API endpoint `/api/video/export` không yêu cầu signature verification (đã được thêm vào publicRoutes)
- Nếu bảng `video_exports` chưa tồn tại, dashboard sẽ hiển thị 0 cho tất cả users
- Dashboard API tự động kiểm tra sự tồn tại của bảng trước khi query











