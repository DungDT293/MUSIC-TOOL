# Hướng Dẫn Sử Dụng Backup và Update Code

## 📁 Các File Đã Tạo

1. **`backup-code.bat`** - Script tự động backup toàn bộ code (có version và timestamp)
2. **`update-code.bat`** - Script tự động update code từ Git
3. **`scripts/backup-simple.ps1`** - PowerShell script hỗ trợ backup

---

## 🔄 Cách Sử Dụng

### 1. Backup Code (`backup-code.bat`)

**Mục đích:** Tạo file ZIP backup toàn bộ code với tên file bao gồm **version** và **timestamp**

**Format tên file:** `backup_v{VERSION}_{YYYYMMDD}_{HHMMSS}.zip`

**Ví dụ:** `backup_v1.0.5_20251206_131719.zip`

**Cách chạy:**
- Double-click vào file `backup-code.bat`
- Hoặc chạy từ Command Prompt: `backup-code.bat`

**Tính năng:**
- ✅ Tự động đọc version từ `package.json`
- ✅ Tạo file backup với tên: `backup_v{VERSION}_{TIMESTAMP}.zip`
- ✅ Tự động tạo thư mục `backups/` nếu chưa có
- ✅ Loại trừ các thư mục/file không cần thiết:
  - `node_modules`
  - `dist`, `dist-electron`, `dist-electron-output`
  - `release`
  - `backups`
  - `.git`, `.vscode`, `.idea`
  - `*.log`, `*.tmp`
- ✅ Hiển thị kích thước file backup
- ✅ Tùy chọn mở thư mục backup sau khi hoàn tất

**Ví dụ output:**
```
========================================
   BACKUP CODE - 93 Media Tool Mix Nhạc
========================================

[1/4] Tạo thư mục backup...
✓ Thư mục backup: D:\...\backups

[2/4] Đang tạo backup...
✓ Tên backup: backup_v1.0.5_20251206_131719
✓ Đường dẫn: D:\...\backups\backup_v1.0.5_20251206_131719

[3/4] Đang nén code...
✓ Backup hoàn tất!
✓ File: backup_v1.0.5_20251206_131719.zip
✓ Kích thước: 1526.39 MB

[4/4] Kiểm tra backup...
========================================
   ✓ BACKUP THÀNH CÔNG!
========================================
```

---

### 2. Restore Code (`restore-code.bat`)

**Mục đích:** Khôi phục code từ file backup khi có bug nặng sau khi nâng cấp

**Cách chạy:**
- Double-click vào file `restore-code.bat`
- Hoặc chạy từ Command Prompt: `restore-code.bat`

**Tính năng:**
- ✅ Hiển thị danh sách tất cả file backup có sẵn
- ✅ Cho phép chọn file backup để restore
- ✅ Tự động backup code hiện tại trước khi restore (tùy chọn)
- ✅ Xác nhận trước khi restore (phải gõ "YES")
- ✅ Giữ nguyên `node_modules`, `backups`, `.git` (không restore)
- ✅ Tự động chạy `npm install` sau khi restore
- ✅ Hiển thị số files đã restore

**Lưu ý quan trọng:**
- ⚠️ **Restore sẽ ghi đè toàn bộ code hiện tại**
- ⚠️ **Nên backup code hiện tại trước khi restore** (script sẽ hỏi)
- ⚠️ **Phải gõ "YES" để xác nhận restore**

**Ví dụ output:**
```
========================================
   RESTORE CODE - 93 Media Tool Mix Nhac
========================================

[1/5] Danh sach file backup:

  [1] backup_v1.0.5_20251206_131719.zip (15.23 MB) - 2025-12-06 13:17:19
  [2] backup_v1.0.4_20251205_143022.zip (14.89 MB) - 2025-12-05 14:30:22

Chon file backup de restore (1-2): 1

OK Da chon: backup_v1.0.5_20251206_131719.zip

[2/5] Canh bao: Backup code hien tai truoc khi restore...
Ban co muon backup code hien tai truoc khi restore? (Y/N): Y

[3/5] Xac nhan restore...
  File backup: backup_v1.0.5_20251206_131719.zip
  Thu muc restore: D:\...\93-media-tool-mix-nhac

  [WARN] Hanh dong nay se:
    - Ghi de toan bo code hien tai
    - Xoa cac file khong co trong backup
    - Giu nguyen node_modules (neu co)

Ban co CHAC CHAN muon restore? (YES de xac nhan): YES

[4/5] Dang extract backup...
OK Da extract backup!

[5/5] Dang restore files...
OK Da restore 1234 files!

[6/6] Dang cai dat dependencies...
OK Da cai dat dependencies!

========================================
   OK RESTORE THANH CONG!
========================================
```

---

### 3. Update Code (`update-code.bat`)

**Mục đích:** Pull code mới nhất từ Git repository và cài đặt dependencies

**Cách chạy:**
- Double-click vào file `update-code.bat`
- Hoặc chạy từ Command Prompt: `update-code.bat`

**Tính năng:**
- ✅ Kiểm tra Git repository
- ✅ Xử lý thay đổi local (stash hoặc commit)
- ✅ Pull code mới nhất từ remote
- ✅ Tự động chạy `npm install` nếu có `package.json`
- ✅ Tùy chọn build exe sau khi update

**Các tình huống:**
1. **Có thay đổi chưa commit:**
   - Option 1: Stash thay đổi và pull
   - Option 2: Commit thay đổi trước khi pull
   - Option 3: Hủy

2. **Không có thay đổi:**
   - Tự động pull code mới nhất

3. **Sau khi pull:**
   - Tự động chạy `npm install` để cài dependencies mới
   - Tùy chọn build exe

---

## 🚀 Workflow Đề Xuất

### Trước khi làm việc:
```bash
# 1. Backup code hiện tại
backup-code.bat

# 2. Update code mới nhất
update-code.bat
```

### Sau khi hoàn thành công việc:
```bash
# Backup lại code đã chỉnh sửa
backup-code.bat
```

### Khi có bug nặng sau khi nâng cấp:
```bash
# 1. Restore từ backup trước đó
restore-code.bat

# 2. Chọn file backup muốn restore
# 3. Xác nhận restore (gõ "YES")
# 4. Script sẽ tự động restore và chạy npm install
```

### Trước khi build exe:
```bash
# 1. Backup code
backup-code.bat

# 2. Build exe
npm run build:win
```

---

## 📦 File Backup

**Format tên file:** `backup_v{VERSION}_{YYYYMMDD}_{HHMMSS}.zip`

**Ví dụ:**
- `backup_v1.0.5_20251206_131719.zip` - Version 1.0.5, tạo lúc 13:17:19 ngày 06/12/2025
- `backup_v1.0.4_20251205_143022.zip` - Version 1.0.4, tạo lúc 14:30:22 ngày 05/12/2025

**Vị trí:** `backups/backup_v{VERSION}_{TIMESTAMP}.zip`

**Khôi phục:**
- **Cách 1 (Tự động - Khuyến nghị):** Chạy `restore-code.bat` và chọn file backup
- **Cách 2 (Thủ công):**
  1. Giải nén file ZIP
  2. Copy nội dung vào thư mục project
  3. Chạy `npm install` để cài dependencies

---

## 🛠️ Troubleshooting

### Lỗi: "Git chưa được cài đặt"
**Giải pháp:** Cài đặt Git từ https://git-scm.com/

### Lỗi: "Không phải Git repository"
**Giải pháp:** 
- Khởi tạo Git: `git init`
- Thêm remote: `git remote add origin <url>`

### Lỗi: "PowerShell execution policy"
**Giải pháp:** Chạy PowerShell với quyền Admin:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Lỗi: "Version không đọc được"
**Giải pháp:** Kiểm tra file `package.json` có field `version` hợp lệ

---

## 📝 Lưu Ý

1. **Backup trước khi update:** Luôn chạy `backup-code.bat` trước khi update code
2. **Kiểm tra thay đổi:** Review thay đổi trước khi commit hoặc stash
3. **Build sau update:** Nên build exe sau khi update để đảm bảo code mới hoạt động
4. **Thư mục backup:** File backup được lưu trong `backups/` ở root project
5. **Tên file backup:** Tự động bao gồm version và timestamp để dễ quản lý

---

**Tạo bởi:** Auto-generated  
**Ngày:** 2025-12-06  
**Version:** 1.0.5


