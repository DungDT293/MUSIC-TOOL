# 🚀 Hướng Dẫn Deploy Server Code (Đã Sửa Lỗi)

## ✅ Các lỗi đã được sửa:

1. **Fix request body double-reading**: Body đã parse từ signature verification được truyền vào `handleRegister` thay vì đọc lại từ request
2. **Add comprehensive error handling**: Bọc toàn bộ logic trong try-catch để tránh worker crash

## 📋 Cách Deploy:

### Cách 1: Dùng Wrangler Login (Khuyến nghị)

1. Mở PowerShell hoặc Command Prompt
2. Chạy lệnh:
```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
npx wrangler login
```
3. Trình duyệt sẽ mở → Đăng nhập Cloudflare → Cho phép truy cập
4. Sau khi login xong, chạy:
```powershell
npx wrangler deploy
```

### Cách 2: Dùng API Token

1. Tạo API Token tại: https://dash.cloudflare.com/profile/api-tokens
   - Chọn template "Edit Cloudflare Workers"
   - Hoặc custom với quyền: Account → Cloudflare Workers → Edit
2. Set token và deploy:
```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
$env:CLOUDFLARE_API_TOKEN = "your-token-here"
npx wrangler deploy
```

### Cách 3: Chạy Script

```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
.\deploy-easy.bat
```

## ✅ Sau Khi Deploy:

1. Kiểm tra server: https://license-server.dungdong333.workers.dev/api/auth/register
2. Test đăng ký từ client app
3. Kiểm tra Cloudflare Workers logs nếu còn lỗi

## 🔧 Nếu Gặp Lỗi:

- **"Not logged in"**: Chạy `npx wrangler login`
- **"Permission denied"**: Kiểm tra token có đủ quyền không
- **"Database not found"**: Kiểm tra `database_id` trong `wrangler.toml`
- **"fetch failed"**: Kiểm tra kết nối mạng/proxy
