# Hướng Dẫn Deploy lên Cloudflare Workers

## Bước 1: Cài đặt Dependencies

```bash
cd server
npm install
```

## Bước 2: Cấu hình Wrangler

1. Login vào Cloudflare:
```bash
npx wrangler login
```

2. Link với D1 Database (nếu chưa có):
```bash
npx wrangler d1 create license-db
```

3. Copy `database_id` từ output và paste vào `wrangler.toml`:
```toml
database_id = "your-database-id-here"
```

## Bước 3: Tạo Database Tables

Chạy các SQL scripts trong Cloudflare D1 Studio hoặc qua CLI:

```bash
# Tạo bảng security_events
npx wrangler d1 execute license-db --file=./database-schema.sql

# Tạo bảng used_nonces
npx wrangler d1 execute license-db --file=./database-schema-nonces.sql

# Tạo bảng machine_id_tracking
npx wrangler d1 execute license-db --file=./database-schema-machine-tracking.sql
```

Hoặc chạy trực tiếp trong Cloudflare D1 Studio.

## Bước 4: Set Secrets

```bash
# Set installer secret
npx wrangler secret put INSTALLER_SECRET

# Set admin token
npx wrangler secret put ADMIN_TOKEN

# Set SendGrid API key (optional)
npx wrangler secret put SENDGRID_API_KEY

# Set alert email (optional)
npx wrangler secret put ALERT_EMAIL

# Set webhook URL (optional)
npx wrangler secret put WEBHOOK_URL
```

## Bước 5: Deploy

```bash
npx wrangler deploy
```

## Bước 6: Test

Sau khi deploy, test các endpoints:

```bash
# Test security report
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

## Cấu trúc Files

```
server/
├── index.ts                    # Main entry point
├── types.d.ts                  # TypeScript definitions
├── security-verification.ts   # Signature verification
├── security-report-endpoint.ts # Security alerts handler
├── auto-block.ts              # Auto-block mechanism
├── dashboard-api.ts           # Admin dashboard API
├── wrangler.toml              # Cloudflare Workers config
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
└── database-schema*.sql       # Database schemas
```

## Environment Variables

- `INSTALLER_SECRET`: Secret key cho installer (required)
- `ADMIN_TOKEN`: Token cho admin dashboard (required)
- `SENDGRID_API_KEY`: API key cho SendGrid email alerts (optional)
- `ALERT_EMAIL`: Email để nhận security alerts (optional)
- `WEBHOOK_URL`: Webhook URL cho Discord/Slack alerts (optional)

## Routes

- `POST /api/auth/register` - Đăng ký tài khoản
- `POST /api/auth/check` - Kiểm tra/đăng nhập
- `POST /api/auth/admin/update` - Admin update (CHO_PHEP/CHAN)
- `POST /api/security/report` - Security alerts
- `GET /api/admin/events` - Dashboard: Get events
- `GET /api/admin/stats` - Dashboard: Get statistics
- `GET /api/admin/top-machines` - Dashboard: Top machines
- `GET /api/admin/top-usernames` - Dashboard: Top usernames

## Notes

- Tất cả routes (trừ `/api/security/report`) đều yêu cầu signature verification
- Signature được verify tự động, reject nếu không hợp lệ
- Auto-block mechanism sẽ tự động block sau N events theo rules
- Multiple machine IDs detection sẽ track và cảnh báo


