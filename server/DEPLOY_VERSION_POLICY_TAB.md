# 🚀 Deploy Version Policy Tab - Hướng Dẫn Nhanh

## ✅ Đã Cập Nhật Code

Tab **"📦 Quản Lý Phiên Bản"** đã được thêm vào dashboard với đầy đủ tính năng:
- Quản lý Stable Channel (latest_version, min_supported_version, blocked_versions, etc.)
- Quản lý Beta Channel (beta_latest_version, beta_update_url, beta_blocked_versions)
- Xem trước policy (JSON preview)
- Lưu và cập nhật policy trực tiếp từ dashboard

## 🚀 Cách Deploy

### Option 1: Dùng Script (Windows)

```bash
cd server
deploy-version-policy.bat
```

### Option 2: Deploy Thủ Công

```bash
cd server
npx wrangler deploy
```

## ✅ Sau Khi Deploy

1. Mở dashboard: `https://license-server.dungdong333.workers.dev/dashboard`
2. Đăng nhập với Admin Token
3. Click tab **"📦 Quản Lý Phiên Bản"** (nằm giữa "Quản Lý License" và "Cài Đặt")
4. Xem/chỉnh sửa version policy
5. Click **"💾 Lưu Cấu Hình"** để cập nhật

## 📋 Tính Năng Mới

### Stable Channel
- Latest Version
- Min Supported Version  
- Recommended Version
- Recommended Installer URL
- Blocked Versions (comma-separated)
- Force Update toggle
- Message

### Beta Channel
- Beta Latest Version (ví dụ: 3.7.0-beta.1)
- Beta Update URL (mặc định: https://license-updates.pages.dev/beta/win/)
- Beta Blocked Versions (comma-separated)

## ⚠️ Lưu Ý

- Code đã được cập nhật trong `server/index.ts`
- Cần deploy lên Cloudflare Workers để thấy thay đổi
- Dashboard sẽ tự động load policy khi mở tab
- Có validation và error handling đầy đủ

## 🔍 Kiểm Tra

Sau khi deploy, verify:
1. Tab "📦 Quản Lý Phiên Bản" xuất hiện trong navigation
2. Form fields load đúng giá trị từ policy hiện tại
3. Có thể lưu và cập nhật policy thành công
4. JSON preview hiển thị đúng
