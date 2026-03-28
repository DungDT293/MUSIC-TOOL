# Hướng Dẫn Chi Tiết: Implement Server Endpoint

## 📖 Server Endpoint Là Gì?

**Server Endpoint** là một địa chỉ URL trên server của bạn để nhận dữ liệu từ client (app của bạn).

Ví dụ:
- Client gửi: `POST https://license-server.dungdong333.workers.dev/api/security/report`
- Server nhận: Xử lý dữ liệu, lưu vào database, gửi email cảnh báo

---

## 🎯 Mục Tiêu

Tạo endpoint `/api/security/report` trên Cloudflare Workers để:
1. ✅ Nhận security alerts từ app
2. ✅ Lưu vào database/logs
3. ✅ Gửi email cảnh báo (nếu có)
4. ✅ Gửi Discord webhook (nếu có)

---

## 📋 Bước 1: Kiểm Tra Server Hiện Tại

Server của bạn đang chạy tại: `license-server.dungdong333.workers.dev`

**Câu hỏi:** Bạn có quyền truy cập vào code của server này không?

- **Có** → Thêm route mới vào code hiện tại (xem Bước 2A)
- **Không** → Tạo worker mới (xem Bước 2B)

---

## 🔧 Bước 2A: Thêm Route Vào Server Hiện Tại

Nếu bạn có quyền truy cập code server:

### 2A.1. Mở file worker chính (thường là `src/index.ts` hoặc `index.ts`)

### 2A.2. Thêm route mới:

```typescript
// Thêm vào đầu file
import { handleSecurityReport } from './security-report-handler'

// Trong export default { async fetch(...) }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    
    // ... existing routes ...
    
    // ✨ THÊM DÒNG NÀY:
    if (url.pathname === '/api/security/report' && request.method === 'POST') {
      return handleSecurityReport(request, env)
    }
    
    // ... existing routes ...
  }
}
```

### 2A.3. Copy code từ `server/security-report-endpoint.ts`

Tạo file mới `src/security-report-handler.ts` và copy toàn bộ code từ `server/security-report-endpoint.ts` vào.

### 2A.4. Deploy lại:

```bash
wrangler deploy
```

---

## 🆕 Bước 2B: Tạo Worker Mới (Nếu Không Có Quyền Truy Cập)

Nếu bạn không có quyền truy cập server hiện tại:

### 2B.1. Cài đặt Wrangler CLI

```bash
npm install -g wrangler
```

### 2B.2. Login vào Cloudflare

```bash
wrangler login
```

### 2B.3. Tạo project mới

```bash
mkdir security-alerts-server
cd security-alerts-server
npm init -y
npm install --save-dev wrangler @cloudflare/workers-types typescript
```

### 2B.4. Tạo file `wrangler.toml`

```toml
name = "security-alerts-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# KV Namespace (optional)
[[kv_namespaces]]
binding = "SECURITY_EVENTS_KV"
id = "your-kv-namespace-id"  # Sẽ tạo sau

# D1 Database (optional)
[[d1_databases]]
binding = "DB"
database_name = "security-events-db"
database_id = "your-database-id"  # Sẽ tạo sau

# Environment variables
[vars]
ALERT_EMAIL = "your-email@example.com"
```

### 2B.5. Tạo file `src/index.ts`

Copy toàn bộ code từ `server/security-report-endpoint.ts` vào file này.

### 2B.6. Deploy

```bash
wrangler deploy
```

---

## 💾 Bước 3: Setup Database (Optional - Khuyến Nghị)

### 3.1. Tạo D1 Database

```bash
wrangler d1 create security-events-db
```

Lưu lại `database_id` từ output.

### 3.2. Update `wrangler.toml`

Thêm `database_id` vào `[[d1_databases]]`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "security-events-db"
database_id = "abc123def456..."  # Paste database_id ở đây
```

### 3.3. Tạo tables

```bash
wrangler d1 execute security-events-db --file=./server/database-schema.sql
```

### 3.4. Test query

```bash
wrangler d1 execute security-events-db --command "SELECT COUNT(*) FROM security_events"
```

---

## 📧 Bước 4: Setup Email Alerts (Optional)

### 4.1. Chọn Email Service

**Option A: SendGrid (Free tier: 100 emails/day)**

1. Đăng ký tại https://sendgrid.com
2. Tạo API Key: Settings → API Keys → Create API Key
3. Set secret:

```bash
wrangler secret put SENDGRID_API_KEY
# Paste API key khi được hỏi
```

**Option B: Resend (Free tier: 3,000 emails/month - Đơn giản hơn)**

1. Đăng ký tại https://resend.com
2. Tạo API Key
3. Set secret:

```bash
wrangler secret put RESEND_API_KEY
```

4. Update code trong `security-report-endpoint.ts`:

```typescript
// Thay sendEmailAlert function
async function sendEmailAlert(event: SecurityEvent, env: Env): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'security@yourdomain.com',
      to: [env.ALERT_EMAIL!],
      subject: `🚨 Security Alert: ${event.event}`,
      text: `Event: ${event.event}\nSeverity: ${event.severity}\nMessage: ${event.message}\nMachine ID: ${event.machineId.substring(0, 16)}...`,
    }),
  })
}
```

### 4.2. Update `wrangler.toml`

```toml
[vars]
ALERT_EMAIL = "your-email@example.com"  # Email của bạn
```

---

## 🔔 Bước 5: Setup Discord Webhook (Optional - Khuyến Nghị)

### 5.1. Tạo Discord Webhook

1. Vào Discord Server của bạn
2. Server Settings → Integrations → Webhooks
3. New Webhook
4. Copy Webhook URL (dạng: `https://discord.com/api/webhooks/123456/abcdef...`)

### 5.2. Update `wrangler.toml`

```toml
[vars]
WEBHOOK_URL = "https://discord.com/api/webhooks/123456/abcdef..."
```

### 5.3. Test webhook

```bash
curl -X POST "https://discord.com/api/webhooks/your-webhook-url" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test message"}'
```

---

## 🧪 Bước 6: Test Endpoint

### 6.1. Test local (nếu có code)

```bash
wrangler dev
```

### 6.2. Test với Postman

1. **Method:** POST
2. **URL:** `https://license-server.dungdong333.workers.dev/api/security/report`
3. **Headers:**
   - `Content-Type: application/json`
4. **Body (JSON):**
```json
{
  "event": "SIGNATURE_INVALID",
  "severity": "high",
  "message": "Test alert from Postman",
  "machineId": "test-machine-id-123",
  "timestamp": 1234567890000,
  "details": {
    "path": "/api/auth/check",
    "method": "POST"
  }
}
```

5. **Send** → Kiểm tra response:
```json
{
  "ok": true,
  "logged": true,
  "timestamp": 1234567890000
}
```

### 6.3. Test với PowerShell (Windows)

```powershell
$body = @{
    event = "SIGNATURE_INVALID"
    severity = "high"
    message = "Test alert from PowerShell"
    machineId = "test-machine-id-123"
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://license-server.dungdong333.workers.dev/api/security/report" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

### 6.4. Kiểm tra logs

1. Vào Cloudflare Dashboard
2. Workers & Pages → Your Worker
3. Logs tab → Xem console.log

---

## 📊 Bước 7: Xem Events Đã Nhận

### 7.1. Xem trong Cloudflare Dashboard

1. Workers & Pages → Your Worker
2. Logs tab → Filter: `[Security Alert]`

### 7.2. Query từ D1 Database

```bash
# Xem 10 events gần nhất
wrangler d1 execute security-events-db --command "SELECT * FROM security_events ORDER BY timestamp DESC LIMIT 10"

# Đếm events theo severity
wrangler d1 execute security-events-db --command "SELECT severity, COUNT(*) as count FROM security_events GROUP BY severity"

# Xem events của một machineId cụ thể
wrangler d1 execute security-events-db --command "SELECT * FROM security_events WHERE machine_id = 'test-machine-id-123' ORDER BY timestamp DESC"
```

### 7.3. Tạo Admin Dashboard (Advanced)

Tạo một page đơn giản để xem events:

```typescript
// src/admin.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Simple auth (nên thêm authentication thật)
    const auth = request.headers.get('Authorization')
    if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 })
    }
    
    const events = await env.DB.prepare(
      `SELECT * FROM security_events 
       ORDER BY timestamp DESC 
       LIMIT 100`
    ).all()
    
    return new Response(JSON.stringify(events.results, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

---

## ✅ Checklist Hoàn Thành

- [ ] Endpoint `/api/security/report` đã được tạo
- [ ] Test endpoint thành công
- [ ] Database đã setup (optional)
- [ ] Email alerts đã setup (optional)
- [ ] Discord webhook đã setup (optional)
- [ ] Đã kiểm tra logs trong Cloudflare Dashboard

---

## 🆘 Troubleshooting

### ❌ Lỗi: "404 Not Found"

**Nguyên nhân:** Route chưa được thêm hoặc pathname sai

**Giải pháp:**
- Kiểm tra `url.pathname === '/api/security/report'`
- Kiểm tra `request.method === 'POST'`
- Deploy lại worker

### ❌ Lỗi: "400 Bad Request - Missing required fields"

**Nguyên nhân:** Request body thiếu fields bắt buộc

**Giải pháp:**
- Kiểm tra request body có đủ: `event`, `severity`, `machineId`
- Kiểm tra Content-Type header: `application/json`

### ❌ Lỗi: "KV namespace not found"

**Nguyên nhân:** KV namespace chưa được tạo hoặc ID sai

**Giải pháp:**
1. Tạo KV namespace trong Cloudflare Dashboard
2. Copy namespace ID
3. Update `wrangler.toml`

### ❌ Lỗi: "D1 database not found"

**Nguyên nhân:** D1 database chưa được tạo hoặc ID sai

**Giải pháp:**
1. Chạy `wrangler d1 create security-events-db`
2. Copy database_id
3. Update `wrangler.toml`
4. Chạy `wrangler d1 execute security-events-db --file=./server/database-schema.sql`

### ❌ Email không được gửi

**Nguyên nhân:** API key sai hoặc chưa set secret

**Giải pháp:**
- Kiểm tra API key
- Set lại secret: `wrangler secret put SENDGRID_API_KEY`
- Kiểm tra `ALERT_EMAIL` trong `wrangler.toml`

### ❌ Events không được lưu vào database

**Nguyên nhân:** Table chưa được tạo hoặc SQL error

**Giải pháp:**
- Chạy lại: `wrangler d1 execute security-events-db --file=./server/database-schema.sql`
- Kiểm tra logs trong Cloudflare Dashboard để xem SQL error

---

## 📞 Hỗ Trợ

Nếu gặp vấn đề, kiểm tra:
1. Cloudflare Dashboard → Workers → Logs
2. Console logs trong worker
3. Network tab trong browser DevTools khi test

---

**Ngày tạo:** 2025-01-XX  
**Phiên bản:** 1.0  
**Tác giả:** Security Team


