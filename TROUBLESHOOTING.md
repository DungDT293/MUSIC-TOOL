# Hướng Dẫn Khắc Phục Sự Cố - 93 Media Tool Mix Nhạc

## 🔴 Vấn Đề: Ứng dụng không khởi động (màn hình đen)

### Bước 1: Kiểm tra DevTools

1. **Mở DevTools:**
   - Nhấn `F12` hoặc `Ctrl + Shift + I`
   - Hoặc click chuột phải → "Inspect Element"

2. **Kiểm tra Console:**
   - Xem có lỗi màu đỏ nào không
   - Copy toàn bộ lỗi và gửi cho admin

### Bước 2: Kiểm tra các lỗi thường gặp

#### ❌ Lỗi: "window.api is not available"

**Nguyên nhân:** Preload script chưa được load đúng cách.

**Giải pháp:**
1. Đảm bảo bạn đang chạy file `.exe` đã build (không phải dev mode)
2. Thử chạy lại ứng dụng với quyền Administrator
3. Kiểm tra Windows Defender/Antivirus có chặn file không
4. Thử tắt tạm thời Windows Defender/Antivirus

#### ❌ Lỗi: "Failed to load index.html"

**Nguyên nhân:** File `index.html` không tìm thấy trong package.

**Giải pháp:**
1. Đảm bảo bạn đã tải đúng file `.exe` (không bị hỏng)
2. Thử tải lại file `.exe` từ nguồn chính thức
3. Kiểm tra dung lượng file (phải > 100 MB)

#### ❌ Lỗi: "Machine ID mismatch"

**Nguyên nhân:** File authentication đã được tạo trên máy khác.

**Giải pháp:**
1. Xóa file `authState.enc` trong thư mục user data:
   - Windows: `%APPDATA%\93-media-tool-mix-nhac\authState.enc`
   - Hoặc: `C:\Users\<TênUser>\AppData\Roaming\93-media-tool-mix-nhac\authState.enc`
2. Khởi động lại ứng dụng
3. Đăng ký/đăng nhập lại

#### ❌ Lỗi: "Không gửi được yêu cầu đăng ký" (app đã build)

**Nguyên nhân:** App build không gửi được request lên server (URL sai, mạng, hoặc decrypt AUTH_BASE lỗi).

**Giải pháp:**
1. **Đặt URL server bằng env:** Tạo file `.env` đặt **cùng thư mục với file .exe** (thư mục cài đặt app), nội dung:
   ```
   AUTH_BASE_URL=https://license-server.dungdong333.workers.dev
   ```
   (thay bằng URL server license thật của bạn nếu khác). Khởi động lại app rồi thử đăng ký lại.
2. **Xem lỗi chi tiết:** Mở app, mở DevTools (F12) → tab Console, hoặc xem log trong `%APPDATA%\93-media-tool-mix-nhac\logs\`. Tìm dòng `[auth:register] Gửi đăng ký thất bại. Code: ... Message: ...` để biết lý do (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, v.v.).
3. Kiểm tra mạng, firewall, VPN/proxy (giống mục "Network error" bên dưới).

#### ❌ Lỗi: "Network error" hoặc "Failed to fetch"

**Nguyên nhân:** Không kết nối được đến license server.

**Giải pháp:**
1. Kiểm tra kết nối internet
2. Kiểm tra Firewall có chặn ứng dụng không
3. Thử tắt VPN/Proxy nếu đang dùng
4. Kiểm tra Windows Firewall:
   - Mở "Windows Defender Firewall"
   - "Allow an app through firewall"
   - Tìm "93 Media - Tool Mix Nhạc" và cho phép

### Bước 3: Kiểm tra file và thư mục

#### Vị trí file user data:
```
Windows: %APPDATA%\93-media-tool-mix-nhac\
Hoặc: C:\Users\<TênUser>\AppData\Roaming\93-media-tool-mix-nhac\
```

#### Các file quan trọng:
- `authState.enc` - File authentication (đã mã hóa)
- `logs/` - Thư mục chứa log files

#### Xóa cache (nếu cần):
1. Đóng ứng dụng hoàn toàn
2. Xóa thư mục `%APPDATA%\93-media-tool-mix-nhac\`
3. Khởi động lại ứng dụng

### Bước 4: Kiểm tra hệ thống

#### Yêu cầu hệ thống:
- **OS:** Windows 10/11 (64-bit)
- **RAM:** Tối thiểu 4 GB (khuyến nghị 8 GB)
- **Disk:** Tối thiểu 500 MB trống
- **.NET Framework:** Không cần (Electron tự chứa)

#### Kiểm tra:
1. **Windows Version:**
   - Nhấn `Win + R` → gõ `winver` → Enter
   - Phải là Windows 10 hoặc 11

2. **RAM:**
   - Nhấn `Ctrl + Shift + Esc` → Task Manager
   - Xem "Memory" có đủ không

3. **Antivirus:**
   - Tạm thời tắt Windows Defender/Antivirus
   - Thử chạy lại ứng dụng

### Bước 5: Chạy với quyền Administrator

1. Click chuột phải vào file `.exe`
2. Chọn "Run as administrator"
3. Cho phép UAC nếu được hỏi

### Bước 6: Kiểm tra Event Viewer (Windows)

1. Nhấn `Win + X` → "Event Viewer"
2. Windows Logs → Application
3. Tìm các lỗi liên quan đến "93 Media" hoặc "Electron"
4. Copy thông tin lỗi và gửi cho admin

### Bước 7: Chạy từ Command Prompt

1. Mở Command Prompt (cmd)
2. Chuyển đến thư mục chứa file `.exe`
3. Chạy: `"93 Media - Tool Mix Nhạc-1.0.5-x64.exe"`
4. Xem output trong console để biết lỗi

### Bước 8: Kiểm tra Log Files

1. Mở thư mục: `%APPDATA%\93-media-tool-mix-nhac\logs\`
2. Xem file log mới nhất
3. Tìm các dòng có "ERROR" hoặc "FATAL"
4. Copy và gửi cho admin

---

## 📋 Checklist Khắc Phục Nhanh

- [ ] Đã mở DevTools (F12) và kiểm tra Console
- [ ] Đã thử chạy với quyền Administrator
- [ ] Đã kiểm tra kết nối internet
- [ ] Đã tắt tạm thời Windows Defender/Antivirus
- [ ] Đã xóa file `authState.enc` nếu có
- [ ] Đã kiểm tra Windows version (10/11)
- [ ] Đã kiểm tra RAM (tối thiểu 4 GB)
- [ ] Đã kiểm tra log files trong `%APPDATA%\93-media-tool-mix-nhac\logs\`

---

## 🆘 Liên Hệ Hỗ Trợ

Nếu vẫn không giải quyết được, vui lòng cung cấp:

1. **Thông tin hệ thống:**
   - Windows version
   - RAM
   - CPU

2. **Lỗi từ DevTools:**
   - Screenshot Console (F12)
   - Copy toàn bộ lỗi

3. **Log files:**
   - File log mới nhất từ `%APPDATA%\93-media-tool-mix-nhac\logs\`

4. **Mô tả vấn đề:**
   - Ứng dụng có mở được không?
   - Màn hình hiển thị gì? (đen, trắng, lỗi?)
   - Có thông báo lỗi nào không?

---

**Version:** 1.0.5  
**Cập nhật:** 2025-12-06


