-- Database Schema cho Used Nonces
-- Dùng để track nonces đã dùng, chống replay attack

-- Tạo table used_nonces
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce_key TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index để query nhanh hơn
CREATE INDEX IF NOT EXISTS idx_used_nonces_expires ON used_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_used_nonces_machine_id ON used_nonces(machine_id);

-- View để xem nonces sắp expire
CREATE VIEW IF NOT EXISTS expiring_nonces AS
SELECT 
  nonce_key,
  machine_id,
  expires_at,
  created_at,
  (expires_at - strftime('%s', 'now') * 1000) as remaining_ms
FROM used_nonces
WHERE expires_at > strftime('%s', 'now') * 1000
ORDER BY expires_at ASC;

-- Cleanup old nonces (chạy định kỳ)
-- DELETE FROM used_nonces WHERE expires_at < strftime('%s', 'now') * 1000;


