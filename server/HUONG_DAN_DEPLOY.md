# 🚀 Hướng Dẫn Deploy Lên Cloudflare Workers

## Cách 1: Dùng Wrangler Login (Đơn Giản Nhất) ⭐

### Bước 1: Mở PowerShell hoặc Command Prompt
```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
```

### Bước 2: Login vào Cloudflare
```powershell
npx wrangler login
```
- Sẽ mở trình duyệt để đăng nhập Cloudflare
- Cho phép Wrangler truy cập vào tài khoản của bạn
- Sau khi login xong, quay lại terminal

### Bước 3: Deploy
```powershell
npx wrangler deploy
```

Hoặc chạy script:
```powershell
.\deploy-version-policy.bat
```

---

## Cách 2: Dùng API Token (Cho CI/CD)

### Bước 1: Tạo API Token
1. Vào: https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Chọn template "Edit Cloudflare Workers" hoặc custom:
   - **Permissions:**
     - Account: Cloudflare Workers:Edit
     - Zone: (nếu có custom domain)
   - **Account Resources:** Chọn account của bạn
4. Click "Continue to summary" → "Create Token"
5. **Copy token** (chỉ hiện 1 lần!)

### Bước 2: Set Token (Windows PowerShell)
```powershell
$env:CLOUDFLARE_API_TOKEN = "your-token-here"
npx wrangler deploy
```

Hoặc set vĩnh viễn (User Environment Variable):
1. Windows Settings → System → About → Advanced system settings
2. Environment Variables → User variables → New
3. Variable name: `CLOUDFLARE_API_TOKEN`
4. Variable value: (paste token)
5. OK → Restart terminal

---

## ✅ Sau Khi Deploy

1. Mở dashboard: https://license-server.dungdong333.workers.dev/dashboard
2. Đăng nhập với Admin Token
3. Kiểm tra tab "📦 Quản Lý Phiên Bản" đã xuất hiện

---

## 🔧 Troubleshooting

### Lỗi: "Failed to fetch auth token"
→ Chưa login hoặc token hết hạn
→ Chạy lại: `npx wrangler login`

### Lỗi: "Database not found"
→ Kiểm tra `database_id` trong `wrangler.toml` có đúng không

### Lỗi: "Permission denied"
→ Token không đủ quyền
→ Tạo token mới với quyền "Edit Cloudflare Workers"

---

## 📝 Checklist

- [ ] Đã login Cloudflare (`npx wrangler login`)
- [ ] Deploy thành công (`npx wrangler deploy`)
- [ ] Dashboard mở được
- [ ] Tab "📦 Quản Lý Phiên Bản" xuất hiện
- [ ] Có thể load và save version policy
