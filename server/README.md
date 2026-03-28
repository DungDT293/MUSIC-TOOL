# Server Endpoint Implementation Guide

## 📋 Tổng Quan

Hướng dẫn chi tiết cách implement endpoint `/api/security/report` trên Cloudflare Workers để nhận security alerts từ client.

---

## 🚀 Bước 1: Setup Cloudflare Workers Project

### 1.1. Cài đặt Wrangler CLI

```bash
npm install -g wrangler
```

### 1.2. Login vào Cloudflare

```bash
wrangler login
```

### 1.3. Tạo project mới (nếu chưa có)

```bash
mkdir license-server
cd license-server
npm init -y
npm install --save-dev wrangler @cloudflare/workers-types
```

---

## 📁 Bước 2: Cấu Trúc Project

```
license-server/
├── src/
│   └── index.ts          # Main worker file
├── wrangler.toml         # Cloudflare config
└── package.json
```

### `wrangler.toml`

```toml
name = "license-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# KV Namespace (optional - để lưu events)
[[kv_namespaces]]
binding = "SECURITY_EVENTS_KV"
id = "your-kv-namespace-id"  # Tạo trong Cloudflare Dashboard

# D1 Database (optional - để lưu events vào SQL)
[[d1_databases]]
binding = "DB"
database_name = "security-events-db"
database_id = "your-database-id"  # Tạo trong Cloudflare Dashboard

# Environment variables
[vars]
ALERT_EMAIL = "your-email@example.com"
WEBHOOK_URL = "https://discord.com/api/webhooks/your-webhook-url"  # Optional

# Secrets (set bằng wrangler secret put)
# SENDGRID_API_KEY = "..."  # Set bằng: wrangler secret put SENDGRID_API_KEY
```

---

## 🔧 Bước 3: Implement Endpoint

### 3.1. Copy code từ `server/security-report-endpoint.ts`

Copy nội dung vào `src/index.ts` hoặc tạo route riêng.

### 3.2. Thêm route vào main worker

Nếu bạn đã có worker, thêm route như sau:

```typescript
// src/index.ts
import securityReportHandler from './security-report-endpoint'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    
    // Route cho security report
    if (url.pathname === '/api/security/report' && request.method === 'POST') {
      return securityReportHandler.fetch(request, env)
    }
    
    // Các routes khác...
    // ...
    
    return new Response('Not found', { status: 404 })
  }
}
```

---

## 💾 Bước 4: Setup Database (Optional)

### 4.1. Tạo D1 Database

```bash
wrangler d1 create security-events-db
```

Lưu `database_id` vào `wrangler.toml`.

### 4.2. Tạo tables

```bash
wrangler d1 execute security-events-db --file=./database-schema.sql
```

Hoặc chạy local:

```bash
wrangler d1 execute security-events-db --local --file=./database-schema.sql
```

### 4.3. Query events

```typescript
// Query events gần đây
const events = await env.DB.prepare(
  `SELECT * FROM security_events 
   WHERE timestamp > ? 
   ORDER BY timestamp DESC 
   LIMIT 100`
).bind(Date.now() - 24 * 60 * 60 * 1000).all()
```

---

## 📧 Bước 5: Setup Email Alerts (Optional)

### 5.1. Tạo SendGrid account

1. Đăng ký tại https://sendgrid.com
2. Tạo API Key
3. Set secret:

```bash
wrangler secret put SENDGRID_API_KEY
# Paste API key khi được hỏi
```

### 5.2. Hoặc dùng Resend (đơn giản hơn)

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
      text: `Event: ${event.event}\nSeverity: ${event.severity}\nMessage: ${event.message}`,
    }),
  })
}
```

---

## 🔔 Bước 6: Setup Discord Webhook (Optional)

### 6.1. Tạo Discord Webhook

1. Vào Discord Server Settings → Integrations → Webhooks
2. Tạo webhook mới
3. Copy webhook URL
4. Thêm vào `wrangler.toml`:

```toml
[vars]
WEBHOOK_URL = "https://discord.com/api/webhooks/your-webhook-url"
```

---

## 🧪 Bước 7: Test Endpoint

### 7.1. Test local

```bash
wrangler dev
```

### 7.2. Test với curl

```bash
curl -X POST http://localhost:8787/api/security/report \
  -H "Content-Type: application/json" \
  -d '{
    "event": "SIGNATURE_INVALID",
    "severity": "high",
    "message": "Test alert",
    "machineId": "test123",
    "timestamp": 1234567890
  }'
```

### 7.3. Test với Postman

1. Method: POST
2. URL: `https://license-server.dungdong333.workers.dev/api/security/report`
3. Headers: `Content-Type: application/json`
4. Body (JSON):
```json
{
  "event": "SIGNATURE_INVALID",
  "severity": "high",
  "message": "Test alert from Postman",
  "machineId": "test-machine-id-123",
  "timestamp": 1234567890,
  "details": {
    "path": "/api/auth/check",
    "method": "POST"
  }
}
```

---

## 🚀 Bước 8: Deploy

```bash
wrangler deploy
```

---

## 📊 Bước 9: Xem Events

### 9.1. Xem trong Cloudflare Dashboard

1. Vào Workers & Pages → Your Worker
2. Xem Logs tab để xem console.log

### 9.2. Query từ D1 Database

```bash
wrangler d1 execute security-events-db --command "SELECT * FROM security_events ORDER BY timestamp DESC LIMIT 10"
```

### 9.3. Tạo Admin Dashboard (Optional)

Tạo một page đơn giản để xem events:

```typescript
// src/admin.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const events = await env.DB.prepare(
      `SELECT * FROM security_events 
       ORDER BY timestamp DESC 
       LIMIT 100`
    ).all()
    
    return new Response(JSON.stringify(events.results), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

---

## 🔒 Bước 10: Bảo Mật Endpoint

### 10.1. Thêm authentication (optional)

```typescript
// Kiểm tra API key trong header
const apiKey = request.headers.get('X-API-Key')
if (apiKey !== env.SECURITY_API_KEY) {
  return new Response('Unauthorized', { status: 401 })
}
```

### 10.2. Rate limiting

```typescript
// Sử dụng Cloudflare Rate Limiting
// Hoặc implement custom với KV
const rateLimitKey = `rate_limit:${event.machineId}`
const count = await env.SECURITY_EVENTS_KV.get(rateLimitKey)
if (count && parseInt(count) > 100) {
  return new Response('Rate limit exceeded', { status: 429 })
}
await env.SECURITY_EVENTS_KV.put(rateLimitKey, '1', { expirationTtl: 60 })
```

---

## 📝 Checklist

- [ ] Setup Cloudflare Workers project
- [ ] Implement endpoint `/api/security/report`
- [ ] Setup KV Namespace (optional)
- [ ] Setup D1 Database (optional)
- [ ] Setup email alerts (optional)
- [ ] Setup Discord webhook (optional)
- [ ] Test endpoint
- [ ] Deploy to production
- [ ] Monitor logs

---

## 🆘 Troubleshooting

### Lỗi: "KV namespace not found"
→ Tạo KV namespace trong Cloudflare Dashboard và update `wrangler.toml`

### Lỗi: "D1 database not found"
→ Tạo D1 database bằng `wrangler d1 create` và update `wrangler.toml`

### Lỗi: "SendGrid API key invalid"
→ Kiểm tra API key và set lại bằng `wrangler secret put SENDGRID_API_KEY`

### Events không được lưu
→ Kiểm tra console logs trong Cloudflare Dashboard để xem lỗi chi tiết

---

**Ngày tạo:** 2025-01-XX  
**Tác giả:** Security Team


