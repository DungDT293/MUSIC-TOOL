# Hướng Dẫn Kiểm Tra Video Exports

## 1. Kiểm tra VIEW đã được tạo chưa

Chạy query sau để xem danh sách các VIEW:

```sql
SELECT name FROM sqlite_master WHERE type='view' AND name='video_exports_stats_by_user';
```

Nếu có kết quả, VIEW đã được tạo thành công.

## 2. Kiểm tra bảng video_exports đã được tạo chưa

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='video_exports';
```

## 3. Kiểm tra cấu trúc bảng

```sql
PRAGMA table_info(video_exports);
```

## 4. Kiểm tra VIEW có dữ liệu không

```sql
SELECT * FROM video_exports_stats_by_user;
```

Nếu chưa có dữ liệu, sẽ trả về rỗng (đây là bình thường vì chưa có user nào xuất video).

## 5. Test thêm dữ liệu mẫu (tùy chọn)

Để test, bạn có thể thêm dữ liệu mẫu:

```sql
INSERT INTO video_exports (username, machine_id, status, timestamp)
VALUES 
  ('hungmay4', 'c909c065185b0ffbaaaa7a0b0e7793e3cc67821b390dd316904033633567ce7f', 'success', 1702800000000),
  ('hungmay4', 'c909c065185b0ffbaaaa7a0b0e7793e3cc67821b390dd316904033633567ce7f', 'success', 1702801000000),
  ('hungmay4', 'c909c065185b0ffbaaaa7a0b0e7793e3cc67821b390dd316904033633567ce7f', 'failed', 1702802000000),
  ('musicprovnno1', '733773b698f894f6a34e3c6b', 'success', 1702803000000);
```

Sau đó chạy lại:

```sql
SELECT * FROM video_exports_stats_by_user;
```

Bạn sẽ thấy:
- hungmay4: total_exports = 3, success_count = 2, failed_count = 1
- musicprovnno1: total_exports = 1, success_count = 1, failed_count = 0

## 6. Xóa dữ liệu test (nếu muốn)

```sql
DELETE FROM video_exports;
```

## Lưu ý

- "This query returned no data" khi tạo VIEW là **bình thường** - có nghĩa là VIEW đã được tạo nhưng chưa có dữ liệu
- VIEW sẽ tự động cập nhật khi có dữ liệu mới trong bảng `video_exports`
- Dashboard sẽ hiển thị số liệu ngay khi có dữ liệu trong bảng











