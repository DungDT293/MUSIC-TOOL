# 93 Media Tool

Ứng dụng desktop xử lý media (nhạc + video) viết bằng TypeScript/JavaScript, chạy trên Electron với UI React. Công cụ hỗ trợ quét nhạc, quản lý playlist, cắt/ghép video, SEO metadata, tải YouTube, và quản lý job xử lý hàng loạt.

## Tổng quan
- Quét thư mục nhạc, đọc metadata (bitrate, duration, tags) bằng ffprobe.
- Tạo/sửa/xóa playlist, xuất playlist (m3u/json) hoặc file audio (MP3/WAV).
- Cắt/ghép video, chuyển đổi định dạng/bitrate (khi cần), final export audio-video 1-1.
- SEO metadata (exiftool + PowerShell) ghi thẳng vào file video.
- YouTube downloader (yt-dlp) với tùy chọn chất lượng, audio-only, embed phụ trợ.
- Job queue cho xử lý batch: pending/running/success/failed, log chi tiết.

## Tính năng chính
- **Music Library & Playlist**: quét thư mục, phân loại theo nghệ sĩ/album/thể loại/folder; tạo/sửa/xóa/export playlist; xuất audio MP3/WAV.
- **Video Editing & Processing**: cắt đoạn theo timecode, ghép clip (concat), copy-stream ưu tiên, chuyển đổi khi cần; final export ghép audio-video 1-1.
- **Metadata & SEO**: chỉnh title/subject/comment/keywords/rating, origin, content; viết metadata thật (exiftool) và field Explorer (PowerShell).
- **Download & Integration**: tải YouTube bằng yt-dlp, chọn chất lượng, chỉ audio hoặc video+audio, lấy info channel/playlist.
- **Batch processing & job queue**: hàng đợi job, trạng thái rõ ràng, log stderr/stdout từ tool ngoài, có cancel và retry.

## Kiến trúc tổng quan
- Electron main process (Node.js) + renderer (React) + preload (contextBridge).
- Backend services (Node modules) gọi ffmpeg/ffprobe/yt-dlp/exiftool/PowerShell qua child_process.
- IPC giữa renderer ↔ main để invoke service, nhận progress.
- Chi tiết xem `docs/architecture.md`.

## Tech stack
- React 18, TypeScript/JavaScript, Vite.
- Electron 28 (main/preload/renderer).
- Node.js (fs/path/child_process/os).
- PowerShell (Windows metadata).
- Công cụ ngoài: ffmpeg, ffprobe, yt-dlp, exiftool (bundle trong `bin/`).

## Yêu cầu hệ thống
- OS: Windows 10/11 (ưu tiên), macOS/Linux cần kiểm tra lại script PowerShell.
- Node.js: >= 18.
- Tool ngoài: đã bundle trong `bin/`; kiểm tra bằng `ffmpeg -version`, `yt-dlp --version`, `exiftool -ver` nếu cần.

## Cài đặt & chạy
```bash
git clone <repo>
cd <repo>
npm install

# Dev
npm run dev

# Build release (installer + portable)
npm run build:app
```
Các biến cấu hình (nếu cần) đặt trong `.env` hoặc file config tùy môi trường (đường dẫn default cho media/output, vị trí tool ngoài).

## Hướng dẫn sử dụng cơ bản
- Quét nhạc: Tab Scan → chọn thư mục → chạy scan → xem kết quả phân loại.
- Playlist: Tab Playlist → tạo/sửa → export m3u/json hoặc xuất MP3/WAV.
- Cắt video: Tab Video Cut → chọn file → nhập timecode → chạy; ghép: Tab Merge → chọn nhiều clip → concat.
- SEO: Tab SEO thô → chọn file/folder → nhập tiêu đề/thể loại/kênh → Áp dụng.
- Tải YouTube: Tab Downloader → nhập URL → chọn chất lượng/only-audio → Download; theo dõi progress/log.

## Job Queue & Batch Processing
- Mỗi tác vụ (cut/merge/export/download) vào hàng đợi.
- Trạng thái: pending → running → success/failed; có cancel.
- Log stdout/stderr của ffmpeg/yt-dlp/exiftool lưu để debug; frontend hiển thị tóm tắt.

## Roadmap (gợi ý)
- Thêm preset render (bitrate/codec) cho video.
- Hỗ trợ nhiều nguồn online (Vimeo, SoundCloud).
- Fallback re-encode tự động khi concat copy-stream lỗi.
- Lưu/khôi phục trạng thái job khi app restart.

## Contributing
- Fork và tạo nhánh tính năng.
- Giữ code TypeScript/ESLint format chuẩn.
- Mô tả thay đổi trong PR, kèm ảnh chụp UI (nếu liên quan).

## License
Liên hệ
email: dungdong333@gmail.com
sđt/zalo: 0393954568
