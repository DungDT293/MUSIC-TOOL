# 🛡️ BACKUP NHANH - HƯỚNG DẪN 1 PHÚT

> **Tóm tắt**: Cách backup và khôi phục code khi gặp lỗi

---

## 🚀 SỬ DỤNG NHANH

### **Trước khi code** (mỗi ngày)
```bash
# Double-click file này:
BACKUP-NHANH.bat
```
✅ Tạo backup trong 5 giây!

---

### **Khi gặp lỗi nặng**
```bash
# Double-click file này:
KHOI-PHUC.bat
```
✅ Chọn phương pháp khôi phục!

---

## 📁 CÁC FILE QUAN TRỌNG

| File | Mục đích | Khi nào dùng |
|------|----------|--------------|
| **BACKUP-NHANH.bat** | Tạo backup nhanh | ✅ Mỗi ngày trước code |
| **KHOI-PHUC.bat** | Khôi phục code | 🚨 Khi gặp lỗi |
| **HUONG_DAN_BACKUP_VA_KHOI_PHUC.md** | Hướng dẫn chi tiết | 📖 Đọc để hiểu rõ |
| **CAI-DAT-BACKUP-TU-DONG.md** | Cài tự động backup | ⚙️ Setup 1 lần |
| **BACKUP-AUTO-DAILY.ps1** | Script tự động | 🤖 Task Scheduler dùng |

---

## 🎯 QUY TRÌNH BACKUP LÝ TƯỞNG

```
┌─────────────────────────────────────┐
│  1. MỖI SÁNG TRƯỚC CODE             │
│     → Chạy BACKUP-NHANH.bat         │
│     ✅ Backup trong 5 giây          │
└─────────────────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│  2. TRONG LÚC CODE                  │
│     → Commit thường xuyên           │
│     → git commit -m "feat: ..."     │
└─────────────────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│  3. KHI GẶP LỖI NẶNG                │
│     → Chạy KHOI-PHUC.bat            │
│     → Chọn backup gần nhất          │
│     ✅ Khôi phục trong 1 phút       │
└─────────────────────────────────────┘
```

---

## 🔥 KỊCH BẢN KHẨN CẤP

### Tình huống: App không chạy, lỗi nhiều!

**Bước 1**: ĐỪNG HOẢNG!
- Bạn có backup
- Code có thể khôi phục

**Bước 2**: Chạy `KHOI-PHUC.bat`

**Bước 3**: Chọn **1. Git Branch** (nhanh nhất)

**Bước 4**: Nhập tên branch backup gần nhất
```
Ví dụ: backup-quick-20260117-0900
```

**Bước 5**: Test app
```bash
npm run dev
```

**✅ XON G! Vậy là đã khôi phục!**

---

## 💡 3 TẦNG BẢO VỆ

```
🔖 GIT BRANCHES       → Backup nhanh (< 5s)
💾 ZIP BACKUPS        → Backup đầy đủ (< 30s)
☁️  REMOTE (GitHub)   → Backup an toàn (tuần 1 lần)
```

---

## ⚙️ CÀI ĐẶT TỰ ĐỘNG (OPTIONAL - 1 LẦN)

Đọc file: `CAI-DAT-BACKUP-TU-DONG.md`

**Lợi ích**:
- ✅ Tự động backup mỗi ngày 9h sáng
- ✅ Không cần nhớ
- ✅ An toàn hơn

---

## 📞 SUPPORT

### Xem log backup tự động
```powershell
Get-Content logs\auto-backup.log -Tail 50
```

### Xem danh sách backups
```bash
# Git branches
git branch --sort=-committerdate | findstr backup-

# ZIP files
dir backups\*.zip /o:-d
```

### Test backup
```bash
# Test Git backup
git checkout backup-quick-20260117-0900
npm run dev

# Quay lại branch hiện tại
git checkout backup-ultrafast-video-20250118-1143
```

---

## 🎓 HỌC THÊM

1. **Hướng dẫn đầy đủ**: `HUONG_DAN_BACKUP_VA_KHOI_PHUC.md`
2. **Cài tự động**: `CAI-DAT-BACKUP-TU-DONG.md`
3. **Git cơ bản**: Google "git basics tutorial"

---

## ✅ CHECKLIST HÀNG NGÀY

- [ ] **Sáng**: Chạy `BACKUP-NHANH.bat`
- [ ] **Trong ngày**: Commit sau mỗi feature
- [ ] **Chiều**: Commit cuối ngày
- [ ] **Cuối tuần**: Push lên GitHub (optional)

---

## 🎉 KẾT LUẬN

**2 FILE BẠN CẦN NHỚ:**
1. `BACKUP-NHANH.bat` - Backup trước khi code
2. `KHOI-PHUC.bat` - Restore khi lỗi

**→ Đơn giản, nhanh, an toàn! 🚀**

---

**Last Updated**: 2026-01-17  
**Version**: 1.0
