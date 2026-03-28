# Hướng Dẫn Thêm Cột Mật Khẩu Vào Cloudflare D1 Database

## Bước 1: Truy cập Cloudflare Dashboard

1. Đăng nhập vào [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Chọn account của bạn
3. Vào **Workers & Pages** → **D1** (hoặc tìm "D1" trong menu)

## Bước 2: Chọn Database

1. Tìm database tên **`license-db`** (hoặc database ID: `93f5890b-ab73-42f7-875e-788193b79c99`)
2. Click vào database đó

## Bước 3: Mở SQL Editor

1. Trong trang database, tìm tab **"Query"** hoặc **"SQL Editor"**
2. Click vào đó để mở SQL Editor

## Bước 4: Chạy Migration Script

Copy và paste từng lệnh sau vào SQL Editor, rồi click **"Run"**:

### Lệnh 1: Kiểm tra cấu trúc bảng hiện tại
```sql
PRAGMA table_info(registrations);
```

Lệnh này sẽ hiển thị danh sách các cột trong bảng `registrations`. Kiểm tra xem đã có cột `mat_khau` và `version` chưa.

### Lệnh 2: Thêm cột mat_khau (nếu chưa có)
```sql
ALTER TABLE registrations ADD COLUMN mat_khau TEXT;
```

**Lưu ý:** Nếu cột đã tồn tại, bạn sẽ thấy lỗi `duplicate column name: mat_khau`. Điều này là bình thường, bạn có thể bỏ qua.

### Lệnh 3: Thêm cột version (nếu chưa có)
```sql
ALTER TABLE registrations ADD COLUMN version TEXT;
```

**Lưu ý:** Tương tự, nếu cột đã tồn tại sẽ có lỗi, bạn có thể bỏ qua.

### Lệnh 4: Xác nhận đã thêm thành công
```sql
SELECT sql FROM sqlite_master WHERE type='table' AND name='registrations';
```

Lệnh này sẽ hiển thị cấu trúc đầy đủ của bảng. Bạn sẽ thấy `mat_khau TEXT` và `version TEXT` trong kết quả.

## Bước 5: Kiểm tra lại Dashboard

1. Quay lại dashboard: `https://license-server.dungdong333.workers.dev/dashboard`
2. Hard refresh (Ctrl+Shift+R)
3. Click vào tab **"Quản Lý Người Dùng"**
4. Kiểm tra xem cột "Mật Khẩu" có hiển thị đúng không

## Troubleshooting

### Nếu gặp lỗi "duplicate column name"
- **Nguyên nhân:** Cột đã tồn tại trong database
- **Giải pháp:** Bỏ qua lỗi này, cột đã được tạo rồi

### Nếu vẫn không thấy dữ liệu
- Kiểm tra lại xem đã chạy đúng lệnh ALTER TABLE chưa
- Thử query: `SELECT id, tai_khoan, mat_khau FROM registrations LIMIT 1;` để xem có dữ liệu không

### Nếu cần cập nhật dữ liệu mật khẩu cho user hiện có
```sql
-- Ví dụ: Cập nhật mật khẩu cho user cụ thể
UPDATE registrations 
SET mat_khau = 'password123' 
WHERE tai_khoan = 'username';
```

## Lưu ý Quan Trọng

⚠️ **Bảo mật:** 
- Cột `mat_khau` sẽ lưu password dạng plaintext (chưa hash)
- Nên cân nhắc hash password trước khi lưu vào database
- Chỉ admin mới có quyền xem password trong dashboard

✅ **Sau khi thêm cột:**
- Dashboard sẽ tự động hiển thị cột "Mật Khẩu"
- Icon mắt (👁️) sẽ cho phép xem/ẩn password
- Dữ liệu mới sẽ tự động có cột này











