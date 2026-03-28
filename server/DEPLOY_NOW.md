# 🚀 Deploy Ngay Bây Giờ

## Bước 1: Đăng Nhập Cloudflare (Nếu Chưa)

```powershell
cd "d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server"
npx wrangler login
```

→ Trình duyệt sẽ mở → Đăng nhập → Cho phép truy cập

---

## Bước 2: Deploy

Sau khi đăng nhập xong, chạy:

```powershell
npx wrangler deploy
```

Hoặc chạy script:
```powershell
.\deploy-easy.bat
```

---

## ✅ Kiểm Tra Sau Khi Deploy

1. Mở: https://license-server.dungdong333.workers.dev/dashboard
2. Đăng nhập với Admin Token
3. Tìm tab **"📦 Quản Lý Phiên Bản"**
4. Test load và save version policy

---

## ❓ Nếu Gặp Lỗi

### "Not logged in"
→ Chạy lại: `npx wrangler login`

### "Permission denied"  
→ Đảm bảo đã cho phép Wrangler truy cập khi login

### "Database not found"
→ Kiểm tra `database_id` trong `wrangler.toml`
