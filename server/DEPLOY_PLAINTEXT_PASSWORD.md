# Deploy: Mật khẩu plaintext (không mã hóa)

## Đã sửa trong code

1. **Đăng ký mới** (`server/index.ts`): Lưu `mat_khau` plaintext, không hash.
2. **Sửa user trong dashboard** (`server/dashboard-api.ts`): Lưu `mat_khau` plaintext khi admin chỉnh sửa.
3. **Đăng nhập / handleCheck** (`server/index.ts`, `server/auth-v2-handlers.ts`): Không auto-migrate sang hash; vẫn hỗ trợ user cũ đã lưu hash (so sánh/verify như cũ).

## Cần deploy để có hiệu lực

Code đã đúng trong repo nhưng **API đang chạy trên Cloudflare Workers vẫn dùng bản cũ** cho đến khi deploy.

**Cách deploy:**

```bat
cd d:\TOOL DUNG CODE\93-media-tool-mix-nhac\server
deploy-now.bat
```

Hoặc:

```bat
cd server
set CLOUDFLARE_API_TOKEN=<token-của-bạn>
npx wrangler deploy
```

Sau khi deploy xong, hãy:
1. Reload trang dashboard (Ctrl+F5).
2. Đăng ký user mới hoặc dùng "Chỉnh sửa" → nhập mật khẩu mới → Lưu → mật khẩu sẽ lưu plaintext và hiển thị được khi bấm 👁️.

## User cũ (đã có trong DB trước khi tắt hash)

Nếu user như `loldungbucutao` vẫn thấy chuỗi dạng `swhkWgMg/...` hoặc `xxx:yyy` trong ô Mật khẩu:

- Đó là **mật khẩu đã lưu dạng hash** trong DB, không thể đổi ngược lại plaintext.
- Trong modal "Chi Tiết Người Dùng" sẽ có dòng gợi ý: *"Mật khẩu đang lưu dạng hash (tài khoản cũ). Dùng Chỉnh sửa → nhập mật khẩu mới → Lưu để lưu plaintext và xem được."*
- Cách xử lý: Vào danh sách user → bấm **Chỉnh sửa** với user đó → nhập **mật khẩu mới** (ví dụ mật khẩu user muốn dùng) → **Lưu**. Lần sau mật khẩu sẽ lưu plaintext và xem được bằng nút 👁️.

## Kiểm tra nhanh sau deploy

1. Dashboard → Quản lý Người dùng → Chỉnh sửa một user → đổi mật khẩu → Lưu.
2. Mở lại Chi tiết user đó → bấm 👁️ bên ô Mật khẩu → phải thấy đúng mật khẩu vừa nhập (plaintext).
