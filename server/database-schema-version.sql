-- Migration: Thêm cột version vào bảng registrations
-- Chạy lệnh này trong Cloudflare D1 Database

ALTER TABLE registrations ADD COLUMN version TEXT;

-- Tạo index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_registrations_version ON registrations(version);


