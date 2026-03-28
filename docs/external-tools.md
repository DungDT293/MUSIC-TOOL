# Công cụ ngoài & PowerShell

## Danh sách tool
- **ffmpeg, ffprobe**: xử lý/cắt/ghép/convert audio/video; probe metadata.
- **yt-dlp**: tải video/playlist/channel YouTube, hỗ trợ chọn format, subtitle, thumbnail.
- **exiftool**: đọc/ghi metadata (EXIF/XMP/ID3/QuickTime).
- **PowerShell**: automation trên Windows (set metadata Explorer fields).

## Cách gọi & I/O chính
- ffprobe: `ffprobe -v quiet -print_format json -show_format -show_streams <file>` → JSON metadata.
- ffmpeg:
  - Cắt: `ffmpeg -i in -ss <start> -to <end> -c copy out`.
  - Cắt segment: `ffmpeg -i in -f segment -segment_time X -c copy out%03d.ext`.
  - Ghép concat: `ffmpeg -f concat -safe 0 -i list.txt -c copy out`.
  - Re-encode khi cần (bitrate/codec) với `-c:v libx264 -b:v ...` hoặc `-c:a aac -b:a ...`.
- yt-dlp:
  - Info: `yt-dlp -J <url>` (JSON).
  - Download: `yt-dlp -f "<format>" [--embed-subs --embed-thumbnail] -o "<template>" <url>`.
- exiftool:
  - Ghi arg-file UTF-8: `exiftool -@ args.txt <file>`, trong đó arg file chứa các cặp `-Tag=Value`.
  - SEO: Title/Subject/Comment/Keywords, Rating (XMP), Genre/Year, Origin, URL, Content fields; charset UTF-8, `-overwrite_original`.
- PowerShell (Explorer fields):
  - Script COM `Shell.Application` set 4 field: Title (cột 21), Subject (22), Comment (24), Rating (19 nhận "0..5"); Subtitle: tìm cột “Subtitle”, nếu không có thì dùng Subject.
  - Chạy sau exiftool để Explorer đọc giá trị cuối; exiftool giữ metadata “thật” trong file.

## Yêu cầu cài đặt / kiểm tra
- ffmpeg/ffprobe: `ffmpeg -version`, `ffprobe -version`.
- yt-dlp: `yt-dlp --version`.
- exiftool: `exiftool -ver`.
- PowerShell: có sẵn trên Windows; chạy script với `-ExecutionPolicy Bypass`.
- Build: binary bundle trong `bin/`, copy sang `resources/bin/` khi đóng gói; có thể override path qua config.

## Lưu ý Windows / cross-platform
- PowerShell COM chỉ dùng cho Explorer trên Windows; macOS/Linux bỏ qua, vẫn ghi metadata bằng exiftool.
- ffmpeg/yt-dlp/exiftool cần quyền thực thi trên macOS/Linux (`chmod +x`).
- Path Unicode/ký tự đặc biệt: dùng arg-file UTF-8 cho exiftool, escape path đúng khi tạo concat list ffmpeg.
