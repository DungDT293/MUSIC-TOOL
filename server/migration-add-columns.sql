-- Migration Script: Thêm cột mat_khau và version vào bảng registrations
-- Chạy script này trong Cloudflare D1 Database Console

-- 1. Thêm cột mat_khau (nếu chưa có)
-- Kiểm tra xem cột đã tồn tại chưa bằng cách chạy:
-- PRAGMA table_info(registrations);

-- Nếu cột mat_khau chưa có, chạy lệnh sau:
ALTER TABLE registrations ADD COLUMN mat_khau TEXT;

-- 2. Thêm cột version (nếu chưa có)
-- Nếu cột version chưa có, chạy lệnh sau:
ALTER TABLE registrations ADD COLUMN version TEXT;

-- 3. Kiểm tra lại cấu trúc bảng sau khi thêm:
-- SELECT sql FROM sqlite_master WHERE type='table' AND name='registrations';

-- Lưu ý:
-- - SQLite không hỗ trợ "IF NOT EXISTS" cho ALTER TABLE ADD COLUMN
-- - Nếu cột đã tồn tại, lệnh sẽ báo lỗi nhưng không ảnh hưởng đến dữ liệu
-- - Có thể bỏ qua lỗi nếu cột đã tồn tại











