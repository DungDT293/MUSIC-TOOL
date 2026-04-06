# Hướng Dẫn Khắc Phục Sự Cố — 93 Media Tool Mix Nhạc v4.0.2

> Cập nhật: 2026-04-02 · Phiên bản: 4.0.2

---

## 🔴 Ứng dụng không khởi động (màn hình đen/trắng)

### Bước 1: Kiểm tra Version Blocking

App v4.0.2 có **Version Gating** — nếu phiên bản quá cũ, app sẽ hiện:
- **"Phiên bản quá cũ"** → Nhấn nút cập nhật (auto-update)
- **"Phiên bản bị chặn"** → Tải installer mới từ link được cung cấp

Nếu không có internet, app sẽ hiện **banner offline** sau 8 giây và cho phép dùng bình thường.

### Bước 2: Kiểm tra DevTools

1. Nhấn `F12` hoặc `Ctrl + Shift + I` (chỉ hoạt động ở dev mode — production đã block)
2. Kiểm tra Console cho lỗi màu đỏ
3. Copy toàn bộ lỗi và gửi cho admin

### Bước 3: Các lỗi thường gặp

#### ❌ Lỗi: "window.api is not available"

**Nguyên nhân:** Preload script chưa được load đúng cách.

**Giải pháp:**
1. Đảm bảo chạy file `.exe` đã build (không phải dev mode)
2. Thử chạy với quyền Administrator
3. Kiểm tra Windows Defender/Antivirus có chặn file không
4. Tắt tạm thời antivirus và thử lại

#### ❌ Lỗi: "Failed to load index.html"

**Nguyên nhân:** File `index.html` không tìm thấy trong package.

**Giải pháp:**
1. Đảm bảo tải đúng file `.exe` (không bị hỏng)
2. Kiểm tra dung lượng file (phải > 100 MB)
3. Tải lại từ nguồn chính thức

#### ❌ Lỗi: "Machine ID mismatch"

**Nguyên nhân:** File authentication tạo trên máy khác hoặc phần cứng đã thay đổi.

**Giải pháp:**
1. Xóa file `authState.enc`:
   ```
   %APPDATA%\93-media-tool-mix-nhac\authState.enc
   ```
2. Khởi động lại ứng dụng
3. Đăng ký/đăng nhập lại
4. Nếu đã thay đổi phần cứng: liên hệ admin để **allow-rebind** machine ID

#### ❌ Lỗi: "Không gửi được yêu cầu đăng ký"

**Nguyên nhân:** Không gửi được request lên license server.

**Giải pháp:**
1. **Đặt URL server bằng env:** Tạo file `.env` cùng thư mục với file `.exe`:
   ```
   AUTH_BASE_URL=https://license-server.dungdong333.workers.dev
   ```
2. **Xem log chi tiết:**
   - Mở `%APPDATA%\93-media-tool-mix-nhac\logs\`
   - Tìm dòng `[auth:register]` hoặc `[auth:login]`
3. Kiểm tra mạng, firewall, VPN/proxy

#### ❌ Lỗi: "Network error" hoặc "Failed to fetch"

**Giải pháp:**
1. Kiểm tra kết nối internet
2. Kiểm tra Firewall: "Windows Defender Firewall" → "Allow an app" → tìm "93 Media"
3. Tắt VPN/Proxy nếu đang dùng

#### ❌ Lỗi: "Tài khoản bị chặn" (banner đỏ)

**Nguyên nhân:** Admin đã revoke tài khoản hoặc auto-block engine phát hiện bất thường.

**Giải pháp:**
1. Liên hệ admin để kiểm tra trạng thái tài khoản
2. Admin có thể approve lại qua Dashboard

---

## 🟡 Sóng nhạc (Visualizer) — Sự cố

#### Export video bị đen/không có hình

1. Kiểm tra đã chọn audio file
2. Kiểm tra có ít nhất 1 layer visible
3. Nếu dùng GPU encode (NVENC): thử lại với **CPU fallback** (app sẽ gợi ý khi GPU fail)
4. Kiểm tra dung lượng ổ đĩa (cần ít nhất 1GB trống)

#### Timeline không hiện waveform

1. Audio file phải là MP3/WAV/AAC/FLAC
2. File quá dài (>15 phút) sẽ được downsample tự động — đợi Web Worker xử lý xong
3. Thử reload page (Ctrl+R trong dev mode)

---

## 🟡 Video — Sự cố

#### FFmpeg lỗi khi cắt/ghép

1. Kiểm tra file video không bị hỏng: chạy "Audit Files" tab trước
2. Codec mismatch khi ghép: app sẽ cảnh báo — cần normalize trước
3. Đường dẫn chứa ký tự đặc biệt: di chuyển file sang thư mục đường dẫn đơn giản

#### GPU encoding thất bại

1. Kiểm tra driver NVIDIA/AMD cập nhật
2. Thử chuyển sang CPU encoding trong Settings
3. Một số video cũ không tương thích GPU encoder

---

## 🟡 YouTube Downloader — Sự cố

#### yt-dlp không hoạt động

1. App tự động update yt-dlp khi khởi động — kiểm tra toast notification
2. Nếu yt-dlp quá cũ (>15 ngày): app sẽ hiện warning
3. Thử manual update: nhấn nút "Cập nhật yt-dlp" trong YouTube tab

#### Age-restricted video

App hỗ trợ browser cookie extraction tự động. Nếu vẫn lỗi:
1. Đăng nhập YouTube trên Chrome/Edge trước
2. Thử lại download

---

## 📁 Vị trí file & thư mục

| File/Thư mục | Đường dẫn |
|--------------|-----------|
| User data | `%APPDATA%\93-media-tool-mix-nhac\` |
| Auth state (encrypted) | `%APPDATA%\93-media-tool-mix-nhac\authState.enc` |
| Log files | `%APPDATA%\93-media-tool-mix-nhac\logs\` |
| External tools | `<app-dir>\bin\` (ffmpeg, ffprobe, yt-dlp, exiftool, AtomicParsley) |

---

## 📋 Checklist Khắc Phục Nhanh

- [ ] Kiểm tra version blocking screen (cập nhật nếu cần)
- [ ] Kiểm tra kết nối internet
- [ ] Tắt tạm thời Windows Defender/Antivirus
- [ ] Chạy với quyền Administrator
- [ ] Xóa file `authState.enc` và đăng nhập lại
- [ ] Kiểm tra Windows version (10/11 64-bit)
- [ ] Kiểm tra RAM (tối thiểu 4 GB)
- [ ] Kiểm tra log files trong `%APPDATA%\93-media-tool-mix-nhac\logs\`
- [ ] Kiểm tra dung lượng ổ đĩa (TopBar hiển thị real-time)

---

## 🆘 Liên Hệ Hỗ Trợ

Cung cấp thông tin sau:

1. **App version** (hiện ở góc dưới sidebar)
2. **Thông tin hệ thống** (Windows version, RAM, CPU — hiện ở TopBar)
3. **Screenshot lỗi** hoặc console output
4. **Log files** từ `%APPDATA%\93-media-tool-mix-nhac\logs\`
5. **Mô tả**: app hiện gì, đang làm gì khi lỗi xảy ra

**Email:** dungdong333@gmail.com
**SĐT/Zalo:** 0393954568
