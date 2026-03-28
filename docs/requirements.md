# Requirements (SRS/BRD tóm tắt)

## Mục tiêu hệ thống
- Ứng dụng desktop hỗ trợ quy trình sản xuất media: quét nhạc, playlist, cắt/ghép video, SEO metadata, tải YouTube, xử lý batch kèm job queue.

## Phạm vi
- Người dùng cá nhân/creator cần quản lý nhiều file audio/video, thao tác batch, tối ưu SEO trước khi upload.

## Persona
- YouTuber / Content Creator: cần cắt/ghép nhanh, chỉnh metadata, tải nguồn từ YouTube.
- Người chơi nhạc/DJ: quét thư viện, tạo playlist, xuất MP3/WAV.
- Editor video đơn giản: concat, cắt, đổi bitrate.

## Yêu cầu chức năng
### Music Library & Playlist
- Quét thư mục/ổ đĩa, đọc metadata (bitrate, duration, tags) → lưu kết quả scan.
- Tạo/sửa/xóa playlist; thêm pinned track; phân loại theo nghệ sĩ/album/genre/folder.
- Xuất playlist: m3u/json; xuất audio MP3/WAV (có kiểm tra dung lượng).
- Lịch sử playlist đã xuất (3 ngày), tra cứu thời gian claim mm:ss → tìm bài.

### Video Editing
- Cắt đoạn theo timecode; cắt nhiều file (batch).
- Ghép nhiều clip (concat copy-stream); shuffle/duration limit; cảnh báo codec mismatch.
- Final export audio-video 1-1: scan nguồn, match số lượng, encode/concat.

### Metadata & SEO
- Chỉnh title/subject/comment/keywords, rating, origin, content fields.
- Ghi metadata thật bằng exiftool (UTF-8); nếu Windows, set thêm 4 field Explorer (Title/Subject/Comment/Rating) bằng PowerShell.
- Hỗ trợ preset kênh/URL/genre; tracklist auto nếu audio khớp.

### Download & Integration
- Tải video/playlist/channel YouTube (yt-dlp).
- Chọn chất lượng (best <= height), audio-only; tùy chọn subtitle/thumbnail embed.
- Hiển thị info video/channel, ước lượng dung lượng; continue on error.

### Batch Processing & Queue
- Mọi tác vụ đưa vào hàng đợi: pending → running → success/failed; có cancel.
- Ghi log stderr/stdout cho từng job; hiển thị progress/ETA.

### Settings & Configuration
- Đường dẫn tool (ffmpeg/ffprobe/yt-dlp/exiftool) có thể cấu hình/auto-detect.
- Thư mục mặc định cho nguồn/output; template đặt tên output.
- Tùy chọn kiểm tra dung lượng (buffer yêu cầu).

## Yêu cầu phi chức năng
- Hiệu năng: xử lý batch hàng chục/hàng trăm file; concurrency giới hạn để tránh nghẽn I/O.
- Độ tin cậy: retry hợp lý, không crash khi tool ngoài trả lỗi; log đầy đủ.
- UX: luôn hiển thị trạng thái job, percent, ETA, lỗi rõ ràng.
- Mở rộng: dễ thêm source download (Vimeo), thêm preset encode, thêm tag metadata.
- Bảo mật: renderer sandbox, chỉ expose API cần thiết; không thực thi lệnh tùy ý từ UI.

## Use case / flow mẫu
- Quét nhạc: người dùng chọn thư mục → scan → xem thống kê → tạo playlist → xuất MP3.
- Cắt nhiều video: chọn danh sách file → nhập timecode → chạy batch → theo dõi progress.
- SEO thô: chọn file/folder → nhập tiêu đề/genre/kênh → Apply → exiftool + PowerShell ghi metadata.
- Tải YouTube: nhập URL → validate → chọn chất lượng → download → xem progress/log; nếu cần, convert audio sau đó.
