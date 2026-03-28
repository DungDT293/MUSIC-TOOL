# 🚀 Deploy Bằng API Token (Đơn Giản Hơn)

## Bước 1: Tạo API Token

1. Mở trình duyệt, vào: **https://dash.cloudflare.com/profile/api-tokens**
2. Click **"Create Token"**
3. Chọn template: **"Edit Cloudflare Workers"** (hoặc custom với quyền Workers:Edit)
4. Click **"Continue to summary"** → **"Create Token"**
5. **Copy token** (chỉ hiện 1 lần, lưu lại!)

## Bước 2: Set Token và Deploy

Mở PowerShell trong thư mục `server` và chạy:

```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"

# Thay YOUR_TOKEN_HERE bằng token bạn vừa copy
$env:CLOUDFLARE_API_TOKEN = "YOUR_TOKEN_HERE"

# Deploy
npx wrangler deploy
```

## ✅ Xong!

Sau khi deploy xong, kiểm tra:
- https://license-server.dungdong333.workers.dev/dashboard
- Tab "📦 Quản Lý Phiên Bản" đã xuất hiện

---

**Lưu ý:** Token chỉ có hiệu lực trong session PowerShell hiện tại. Nếu muốn dùng lại, set lại biến môi trường.
