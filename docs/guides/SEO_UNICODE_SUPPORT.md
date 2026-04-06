# SEO Metadata Unicode Support

## 🌍 Hỗ trợ Unicode đầy đủ

Hệ thống SEO Metadata đã được nâng cấp để hỗ trợ **đầy đủ Unicode** cho tất cả các ngôn ngữ:

- ✅ **Tiếng Việt**: Tiêu đề, kênh, thể loại với dấu đầy đủ
- ✅ **Tiếng Trung**: 中文视频, 中国频道, 娱乐
- ✅ **Tiếng Nhật**: 日本語動画, 日本のチャンネル, エンターテインメント
- ✅ **Tiếng Indonesia**: Video Bahasa Indonesia, Saluran Indonesia, Hiburan
- ✅ **Tiếng Anh**: English titles, channels, genres
- ✅ **Và tất cả ngôn ngữ khác** sử dụng Unicode

---

## 🔧 Implementation Details

### 1. AtomicParsley (iTunes atoms)

- **Encoding**: UTF-8 được đảm bảo qua `spawn` với `utf8` encoding cho stderr
- **Unicode support**: AtomicParsley version 2024+ hỗ trợ đầy đủ Unicode
- **Test**: `AtomicParsley.exe --version` hiển thị `(utf16)` - hỗ trợ Unicode tốt

### 2. Exiftool (Extended tags)

- **Charset flags**: Đã có đầy đủ charset UTF-8:
  ```typescript
  '-charset', 'filename=utf8',
  '-charset', 'exiftool=utf8',
  '-charset', 'iptc=utf8',
  '-charset', 'quicktime=utf8',
  '-charset', 'id3=utf8',
  '-codedcharacterset=utf8'
  ```
- **Arg file**: Sử dụng arg-file (`-@ args.txt`) với UTF-8 encoding để tránh mất dấu trên Windows

### 3. PowerShell (Windows Property System)

- **Script encoding**: PowerShell script được ghi với `encoding: 'utf8'`
- **Parameter passing**: Unicode strings được truyền trực tiếp qua command line arguments
- **Windows Explorer**: Tự động hiển thị Unicode đúng trong Properties

---

## ✅ Test Cases

### Test với nhiều ngôn ngữ:

1. **Tiếng Việt**:
   - Title: "Video Tiếng Việt - Hướng dẫn SEO"
   - Channel: "Kênh Việt Nam"
   - Genre: "Giải trí"

2. **Tiếng Trung**:
   - Title: "中文视频 - SEO教程"
   - Channel: "中国频道"
   - Genre: "娱乐"

3. **Tiếng Nhật**:
   - Title: "日本語動画 - SEOガイド"
   - Channel: "日本のチャンネル"
   - Genre: "エンターテインメント"

4. **Tiếng Indonesia**:
   - Title: "Video Bahasa Indonesia - Panduan SEO"
   - Channel: "Saluran Indonesia"
   - Genre: "Hiburan"

5. **Mixed (Nhiều ngôn ngữ)**:
   - Title: "Mixed: Tiếng Việt + 中文 + 日本語 + Bahasa"
   - Channel: "Multi-language Channel"
   - Genre: "Multi-genre"

---

## 🧪 Testing

### Manual Test:

1. Mở app → Tab "8. SEO thô video"
2. Chọn file MP4
3. Nhập metadata với Unicode:
   - Title: "Video Tiếng Việt - 中文 - 日本語"
   - Channel: "Kênh Đa Ngôn Ngữ"
   - Genre: "Giải trí / 娱乐 / エンターテインメント"
4. Click "Áp dụng SEO"
5. Kiểm tra Windows Explorer Properties:
   - Right-click file → Properties → Details tab
   - Tất cả trường phải hiển thị đúng Unicode

### Automated Test Script:

```powershell
.\scripts\test-seo-unicode.ps1 -VideoPath "path\to\video.mp4"
```

Script sẽ test với tất cả các ngôn ngữ trên và verify metadata.

---

## 🔍 Verification

### 1. Exiftool verification:

```bash
bin\exiftool.exe -s -s -s -Title video.mp4
bin\exiftool.exe -s -s -s -Artist video.mp4
bin\exiftool.exe -s -s -s -Genre video.mp4
```

### 2. Windows Explorer Properties:

- Right-click file → Properties → Details tab
- Kiểm tra các trường:
  - ✅ Title
  - ✅ Subtitle
  - ✅ Tags
  - ✅ Genre
  - ✅ Year
  - ✅ Rating
  - ✅ Directors
  - ✅ Producers
  - ✅ Writers
  - ✅ Publisher
  - ✅ Copyright
  - ✅ Encoded by

### 3. MediaInfo (nếu có):

```bash
MediaInfo video.mp4
```

---

## ⚠️ Troubleshooting

### Vấn đề: Metadata hiển thị sai ký tự (mojibake)

**Nguyên nhân**: Encoding không đúng

**Giải pháp**:
1. Đảm bảo file PowerShell script được ghi với UTF-8 encoding
2. Kiểm tra exiftool charset flags đã đầy đủ
3. Test với AtomicParsley version mới nhất (2024+)

### Vấn đề: Windows Explorer không hiển thị Unicode

**Nguyên nhân**: PowerShell script không set đúng encoding

**Giải pháp**:
1. Kiểm tra PowerShell script có `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` (nếu cần)
2. Đảm bảo Windows locale hỗ trợ Unicode
3. Restart Windows Explorer sau khi apply metadata

### Vấn đề: AtomicParsley không ghi Unicode

**Nguyên nhân**: Version cũ hoặc encoding không đúng

**Giải pháp**:
1. Download AtomicParsley version mới nhất (2024+)
2. Kiểm tra `AtomicParsley.exe --version` hiển thị `(utf16)` hoặc `(utf8)`
3. Test manual: `AtomicParsley.exe video.mp4 --title "Test 中文" --overWrite`

---

## 📋 Checklist Unicode Support

- [x] AtomicParsley hỗ trợ Unicode (version 2024+)
- [x] Exiftool charset flags đầy đủ (UTF-8)
- [x] PowerShell script encoding UTF-8
- [x] Windows Property System hiển thị Unicode
- [x] Test với tiếng Việt, Trung, Nhật, Indo
- [x] Verify bằng Windows Explorer Properties
- [x] Verify bằng exiftool command line

---

## 🎉 Kết quả

Sau khi apply metadata với Unicode:

✅ **Tất cả metadata fields hiển thị đúng Unicode** trong:
- Windows Explorer Properties
- Exiftool output
- MediaInfo (nếu có)
- Các media players hỗ trợ metadata

✅ **Không có mất dấu hoặc mojibake**

✅ **Hỗ trợ đầy đủ tất cả ngôn ngữ Unicode**

---

**Last updated**: 2025-11-26
