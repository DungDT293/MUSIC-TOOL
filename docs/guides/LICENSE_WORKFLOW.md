## License Workflow (Cloudflare Worker – chế độ duyệt tay)

Phiên bản mới bỏ hoàn toàn các file `.lic`. App tự gửi yêu cầu lên server, admin duyệt rồi mới phát ticket. Các thành phần chính:

- **Cloudflare Worker + D1** đóng vai trò license server.
- **pending_requests**: lưu các yêu cầu kích hoạt đang chờ duyệt.
- **licenses**: lưu các license đã được cấp (ticket + machine_id).
- **App**: tạo yêu cầu, polling trạng thái, lưu ticket trong `C:\ProgramData\93MediaToolMixNhac\licenseTicket.json`.

### 1. Luồng người dùng

1. Cài đặt app → mở lần đầu sẽ thấy trang “Kích hoạt license”.
2. Người dùng chỉ việc bấm “Gửi yêu cầu kích hoạt” (có thể nhập ghi chú tuỳ chọn).
3. App gửi `POST /api/licenses/register` với `{ machineId, version, note? }`.
4. Server lưu yêu cầu vào `pending_requests`, trả về `requestId`, app hiển thị trạng thái “Đang chờ phê duyệt”.
5. Admin đăng nhập dashboard (hoặc dùng API) để phê duyệt.
6. Khi admin approve, server sinh `ticket` → app polling `/api/licenses/poll` sẽ nhận được ticket và bắt đầu chạy bình thường.

### 2. API endpoints

| Endpoint | Mô tả | Ghi chú |
| --- | --- | --- |
| `POST /api/licenses/register` | App gửi yêu cầu mới. | Header `x-installer-key: Ins$2025!LEONYG`. Trả về `{ status: 'pending', requestId }`. |
| `POST /api/licenses/poll` | App kiểm tra xem request đã được duyệt chưa. | Body `{ requestId, machineId }`. Trả về `pending/approved/denied`. |
| `POST /api/licenses/check` | App đã có ticket dùng để xác thực mỗi lần chạy. | Trả `{ allow: true/false }`. |
| `POST /api/licenses/admin/update` | Admin thao tác license (DISABLE / ENABLE / RESET_MACHINE). | Header `x-admin-token`. |
| `POST /api/licenses/admin/approve` *(cần viết trên Worker)* | Admin duyệt yêu cầu → sinh ticket. | Khi approve, ghi vào bảng `licenses` và xóa `pending_requests`. |

### 3. Schema gợi ý

```sql
CREATE TABLE pending_requests (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  version TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  ticket TEXT,
  last_check_at TEXT,
  note TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  action TEXT,
  detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 4. Quy trình admin

1. Mở trang quản trị D1 hoặc viết UI nhỏ gọi API admin.
2. Lấy danh sách `pending_requests`.
3. Khi approve, gọi endpoint admin (ví dụ `POST /api/licenses/admin/approve`) cùng `requestId`:
   - Sinh `ticket = uuid`.
   - Ghi vào bảng `licenses` (machine_id, version, status ACTIVE, ticket).
   - Xóa dòng trong `pending_requests`.
4. Nếu muốn từ chối, cập nhật `pending_requests.status = 'DENIED'`, app sẽ báo người dùng gửi lại.
5. Khi cần khoá máy đã kích hoạt → gọi `admin/update` với action `DISABLE`.

### 5. Hành vi ở phía app

- `submitLicenseRequest(note?)`: gọi `/register`. Nếu server cho pending → lưu `{ requestId, note }`. Nếu được approve ngay lập tức (hiếm) → nhận ticket luôn.
- `evaluateLicenseState()`:
  - Có `ticket` → gọi `/check`.
  - Có `requestId` nhưng chưa có ticket → gọi `/poll`.
  - Không có dữ liệu → trạng thái `needsRegistration`.
- `retry`: ép gọi lại `/poll` hoặc `/check`.
- `clear`: xoá file lưu request/ticket, dùng khi muốn gửi yêu cầu mới.
- Nếu mất mạng nhưng đã kiểm tra thành công trong 24h → chạy ở `offline mode` (hiện banner cảnh báo).

### 6. Biến môi trường

- `LICENSE_SERVER_BASE`: URL Worker (`https://license-server.dungdong333.workers.dev`).
- `LICENSE_INSTALLER_KEY`: Secret để ngăn app chỉnh sửa `/register`. Đặt env khi build nếu muốn thay.
- `ADMIN_TOKEN`: chỉ dùng cho endpoint admin; không nằm trong app.

### 7. Build / deploy

```powershell
set LICENSE_SERVER_BASE=https://your-worker.workers.dev
set LICENSE_INSTALLER_KEY=NewSecret123
npm run build:win-installer
```

### 8. Reset trên máy khách

- Nút “Huỷ yêu cầu” trong UI sẽ xoá `licenseTicket.json`.
- Có thể xóa thủ công tại `C:\ProgramData\93MediaToolMixNhac\licenseTicket.json` nếu cần thu hồi quyền.

Nhờ mô hình “gửi yêu cầu – admin duyệt”:
- Nhân viên không cần biết mã license.
- Bạn kiểm soát được từng máy nào đã yêu cầu.
- Có thể phê duyệt/khóa/từ chối ngay trên server, app sẽ cập nhật sau vài giây.  

