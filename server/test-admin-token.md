# 🔍 Kiểm Tra Admin Token

## Vấn Đề
Dashboard không đăng nhập được dù nhập đúng admin token.

## Cách Kiểm Tra

### Bước 1: Test Token Trực Tiếp

Mở PowerShell và chạy:

```powershell
# Thay YOUR_ADMIN_TOKEN bằng token bạn đang dùng
$token = "YOUR_ADMIN_TOKEN"
$response = Invoke-WebRequest -Uri "https://license-server.dungdong333.workers.dev/api/admin/events?limit=1" -Headers @{ "Authorization" = "Bearer $token" }
$response.StatusCode
```

- Nếu trả về `200` → Token đúng
- Nếu trả về `401` → Token sai hoặc không khớp

### Bước 2: Xem Token Hiện Tại Trong Cloudflare

```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
$env:CLOUDFLARE_API_TOKEN = "ilJo9lCFk4VV7qbdC5WgkjJYTVF6y4xF3Le26Ied"
npx wrangler secret list
```

### Bước 3: Set Lại Token (Nếu Cần)

Nếu token không đúng, set lại:

```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
$env:CLOUDFLARE_API_TOKEN = "ilJo9lCFk4VV7qbdC5WgkjJYTVF6y4xF3Le26Ied"
npx wrangler secret put ADMIN_TOKEN
```

→ Sẽ hỏi bạn nhập token mới (gõ token và Enter)

---

## Debug Trong Browser

1. Mở dashboard: https://license-server.dungdong333.workers.dev/dashboard
2. Mở Developer Tools (F12)
3. Vào tab **Console**
4. Nhập token và test:

```javascript
// Test token
const token = "YOUR_ADMIN_TOKEN"
fetch('https://license-server.dungdong333.workers.dev/api/admin/events?limit=1', {
  headers: { 'Authorization': `Bearer ${token}` }
})
.then(r => r.json())
.then(console.log)
.catch(console.error)
```

- Nếu thấy data → Token đúng
- Nếu thấy `{error: "Unauthorized"}` → Token sai

---

## Lưu Ý

- Token phải **chính xác** (không có khoảng trắng thừa)
- Token trong Cloudflare Workers secrets phải **khớp** với token bạn nhập
- Sau khi set token mới, có thể cần đợi vài giây để sync
