# HƯỚNG DẪN CÀI ĐẶT ATOMICPARSLEY

## 🎯 Tại sao cần AtomicParsley?

AtomicParsley là công cụ **QUAN TRỌNG NHẤT** để ghi iTunes-style atoms vào file MP4.

Windows Explorer **ƯU TIÊN ĐỌC iTunes atoms** hơn các tag khác.

**Không có AtomicParsley → Thiếu nhiều trường metadata quan trọng!**

---

## 📥 Download Links

### Option 1: Official GitHub Release (Khuyến nghị)

**Link**: https://github.com/wez/atomicparsley/releases/latest

Tìm file:

- Windows 64-bit: `AtomicParsley-x64-Windows.zip`
- Windows 32-bit: `AtomicParsley-x86-Windows.zip`

### Option 2: SourceForge (Backup)

**Link**: https://sourceforge.net/projects/atomicparsley/files/

Download file: `AtomicParsley-win32-xxx.zip`

### Option 3: Chocolatey (nếu đã cài Chocolatey)

```bash
choco install atomicparsley
```

Sau đó copy từ: `C:\ProgramData\chocolatey\bin\AtomicParsley.exe`

---

## 📂 Đặt file vào đâu?

### Development mode:

```
YOUR_PROJECT/
├── bin/
│   ├── AtomicParsley.exe  ← Đặt ở đây
│   └── exiftool.exe        ← Đã có
├── backend/
├── src/
└── ...
```

### Production build:

```
YOUR_APP/
├── resources/
│   └── bin/
│       ├── AtomicParsley.exe  ← Đặt ở đây
│       └── exiftool.exe
└── ...
```

---

## ✅ Kiểm tra đã cài đặt đúng chưa

### Test 1: Chạy command line

```bash
cd bin
AtomicParsley.exe --version
```

Kết quả mong đợi:

```
AtomicParsley version: 0.9.x (build xxx)
```

### Test 2: Trong code

Code sẽ tự động tìm AtomicParsley trong các path sau:

1. `process.cwd()/bin/AtomicParsley.exe`
2. `process.cwd()/bin/AtomicParsley`
3. `resourcesPath/bin/AtomicParsley.exe`

Nếu không tìm thấy → Console sẽ warning:

```
⚠️ AtomicParsley.exe not found in bin/ - iTunes atoms will not be written
```

---

## 🔧 Troubleshooting

### Lỗi: "AtomicParsley is not recognized..."

**Nguyên nhân**: File không đúng path

**Giải pháp**: 

1. Kiểm tra file có tên CHÍNH XÁC là `AtomicParsley.exe`
2. Đặt trong folder `bin/` ở root project
3. Restart Electron app

### Lỗi: "Access denied" hoặc "Permission denied"

**Nguyên nhân**: Windows block file từ internet

**Giải pháp**:

1. Right-click file → Properties
2. Tab "General" → Check "Unblock"
3. Click OK

### Lỗi: "DLL not found" hoặc "VCRUNTIME140.dll missing"

**Nguyên nhân**: Thiếu Visual C++ Runtime

**Giải pháp**:

Download và cài: https://aka.ms/vs/17/release/vc_redist.x64.exe

---

## 📋 Checklist hoàn tất

- [ ] Downloaded AtomicParsley.exe
- [ ] Unblocked file (Properties → Unblock)
- [ ] Placed in `bin/AtomicParsley.exe`
- [ ] Tested with `--version` command
- [ ] No console warnings when running app
- [ ] Test apply metadata → Check Windows Properties → All fields filled

---

## 🎉 Kết quả mong đợi

Sau khi cài đặt đúng và chạy SEO metadata:

**Windows Properties sẽ hiển thị ĐẦY ĐỦ:**

- ✅ Title, Subtitle, Tags
- ✅ Genre, Year, Rating (5 sao)
- ✅ Directors, Producers, Writers
- ✅ Publisher, Content provider
- ✅ Copyright, Encoded by
- ✅ Media created, Parental rating
- ✅ Composers, Conductors, Period, Mood...

**TẤT CẢ CÁC TRƯỜNG ĐỀU CÓ GIÁ TRỊ!**

---

## 🆘 Cần trợ giúp?

Nếu vẫn gặp vấn đề:

1. Check console logs khi run app
2. Test manual: `AtomicParsley.exe test.mp4 --title "Test" --overWrite`
3. Verify output: Check Windows Properties của test.mp4

---

**Link download nhanh**: https://github.com/wez/atomicparsley/releases/latest

