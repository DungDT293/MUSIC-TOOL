# Hướng Dẫn Deploy lên Cloudflare Workers

## 📋 Tổng Quan

Code hoàn chỉnh để deploy lên Cloudflare Workers với đầy đủ tính năng bảo mật:
- Signature verification
- Multiple machine IDs detection
- Auto-block mechanism
- Security alerts
- Admin dashboard API

## 🚀 Bước 1: Cài đặt Dependencies

```bash
cd server
npm install
```

## 🔧 Bước 2: Cấu hình Wrangler

### 2.1. Login vào Cloudflare

```bash
npx wrangler login
```

### 2.2. Link với D1 Database

Nếu chưa có database, tạo mới:

```bash
npx wrangler d1 create license-db
```

Copy `database_id` từ output và paste vào `wrangler.toml`:

```toml
database_id = "your-database-id-here"
```

Nếu đã có database, chỉ cần update `database_id` trong `wrangler.toml`.

## 📊 Bước 3: Tạo Database Tables

Chạy các SQL scripts trong Cloudflare D1 Studio hoặc qua CLI:

### Option 1: Qua D1 Studio (Khuyến nghị)

1. Vào Cloudflare Dashboard → D1 → license-db → Studio
2. Chạy từng SQL script:
   - `database-schema.sql` (security_events)
   - `database-schema-nonces.sql` (used_nonces)
   - `database-schema-machine-tracking.sql` (machine_id_tracking)

### Option 2: Qua CLI

```bash
# Tạo bảng security_events
npx wrangler d1 execute license-db --file=./database-schema.sql

# Tạo bảng used_nonces
npx wrangler d1 execute license-db --file=./database-schema-nonces.sql

# Tạo bảng machine_id_tracking
npx wrangler d1 execute license-db --file=./database-schema-machine-tracking.sql
```

## 🔐 Bước 4: Set Secrets

Set các secrets cần thiết:

```bash
# Required: Installer secret (cho /api/auth/register)
npx wrangler secret put INSTALLER_SECRET

# Required: Admin token (cho /api/auth/admin/update và dashboard)
npx wrangler secret put ADMIN_TOKEN

# Optional: SendGrid API key (cho email alerts)
npx wrangler secret put SENDGRID_API_KEY

# Optional: Alert email (để nhận security alerts)
npx wrangler secret put ALERT_EMAIL

# Optional: Webhook URL (cho Discord/Slack alerts)
npx wrangler secret put WEBHOOK_URL
```

## 🚀 Bước 5: Deploy

```bash
npx wrangler deploy
```

Sau khi deploy thành công, bạn sẽ nhận được URL như:
```
https://license-server.your-subdomain.workers.dev
```

## ✅ Bước 6: Test

### Test Security Report Endpoint

```bash
curl -X POST https://your-worker.workers.dev/api/security/report \
  -H "Content-Type: application/json" \
  -d '{
    "event": "TEST_EVENT",
    "severity": "low",
    "message": "Test message",
    "machineId": "test-123",
    "timestamp": 1234567890
  }'
```

### Test Dashboard API

```bash
curl -X GET "https://your-worker.workers.dev/api/admin/stats?hours=24" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## 📁 Cấu trúc Files

```
server/
├── index.ts                    # Main entry point (deploy file này)
├── types.d.ts                  # TypeScript definitions
├── security-verification.ts    # Signature verification
├── security-report-endpoint.ts # Security alerts handler
├── auto-block.ts              # Auto-block mechanism
├── dashboard-api.ts           # Admin dashboard API
├── wrangler.toml              # Cloudflare Workers config
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── database-schema.sql         # Security events table
├── database-schema-nonces.sql  # Used nonces table
└── database-schema-machine-tracking.sql # Machine tracking table
```

## 🔗 API Endpoints

### Auth Endpoints

- `POST /api/auth/register` - Đăng ký tài khoản
  - Header: `x-installer-key: YOUR_INSTALLER_SECRET`
  - Body: `{ tai_khoan, mat_khau, ma_may }`
  - **Yêu cầu signature verification**

- `POST /api/auth/check` - Kiểm tra/đăng nhập
  - Body: `{ tai_khoan, mat_khau, ma_may }`
  - **Yêu cầu signature verification**
  - Tự động track machine IDs và detect multiple machines

- `POST /api/auth/admin/update` - Admin update (CHO_PHEP/CHAN)
  - Header: `x-admin-token: YOUR_ADMIN_TOKEN`
  - Body: `{ id, hanh_dong: 'CHO_PHEP' | 'CHAN' }`
  - **Yêu cầu signature verification**

### Security Endpoints

- `POST /api/security/report` - Security alerts
  - Body: `{ event, severity, message, machineId, timestamp, ... }`
  - **KHÔNG yêu cầu signature** (để tránh loop)

### Dashboard Endpoints (Admin Only)

- `GET /api/admin/events` - Get security events
  - Header: `Authorization: Bearer YOUR_ADMIN_TOKEN`
  - Query: `?severity=high&limit=100&offset=0`

- `GET /api/admin/stats` - Get statistics
  - Header: `Authorization: Bearer YOUR_ADMIN_TOKEN`
  - Query: `?hours=24`

- `GET /api/admin/top-machines` - Top machines with most events
  - Header: `Authorization: Bearer YOUR_ADMIN_TOKEN`
  - Query: `?limit=10&hours=24`

- `GET /api/admin/top-usernames` - Top usernames with most events
  - Header: `Authorization: Bearer YOUR_ADMIN_TOKEN`
  - Query: `?limit=10&hours=24`

## 🔒 Security Features

1. **Signature Verification**: Tất cả requests (trừ `/api/security/report`) đều được verify signature
2. **Nonce Tracking**: Track nonces đã dùng để chống replay attack
3. **Multiple Machine IDs Detection**: Tự động phát hiện account sharing
4. **Auto-Block**: Tự động block sau N events theo rules
5. **Security Alerts**: Tự động report và log security events

## 📝 Notes

- File `index.ts` là file chính để deploy
- File `index-integration-example.ts` chỉ là example, không cần deploy
- Tất cả routes (trừ `/api/security/report`) đều yêu cầu signature verification
- Signature được verify tự động, reject nếu không hợp lệ
- Auto-block mechanism sẽ tự động block sau N events theo rules trong `auto-block.ts`
- Multiple machine IDs detection sẽ track và cảnh báo khi phát hiện > 1 machineId

## 🐛 Troubleshooting

### Lỗi "Cannot find name 'Request'"

Đảm bảo `tsconfig.json` có `"lib": ["ES2022", "DOM"]`

### Lỗi "Database not available"

Kiểm tra `wrangler.toml` có đúng `database_id` và đã link database chưa

### Lỗi "Invalid request signature"

Đảm bảo client đang gửi đúng signature headers:
- `x-timestamp`
- `x-nonce`
- `x-signature`
- `x-machine-id`

## 📚 Tài liệu tham khảo

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)


