# Kiến trúc hệ thống

## Tổng quan
Ứng dụng gồm 3 phần chính:
- **Renderer (React)**: UI quản lý nhạc/video/SEO/Downloader, subscribe progress, hiển thị log.
- **Preload (contextBridge)**: expose `window.api` (music/video/system/dialog/youtube/finalExport/seo) từ main.
- **Main (Electron)**: đăng ký IPC, điều phối backend services, spawn công cụ ngoài (ffmpeg/ffprobe/yt-dlp/exiftool/PowerShell).

Luồng dữ liệu:
```
UI (React) --IPC invoke/on--> Main (ipcMain) --services--> child_process (ffmpeg/yt-dlp/exiftool/ps)
                                            \--> FS/Config/JobQueue
```

## Module/Layers
- **UI Layer (React)**: màn hình Library/Playlist, Video Editor (Cut/Merge/Final Export), SEO, YouTube Downloader, Settings.
- **Service Layer (Node modules)**:
  - MediaScanService: quét thư mục, ffprobe metadata.
  - PlaylistService: xây playlist, export list/audio.
  - VideoProcessingService: cut/merge/convert simple, final export 1-1.
  - MetadataService: SEO (exiftool ghi “thật” UTF-8 + PowerShell set 4 field Explorer).
  - DownloadService: yt-dlp (get info, download single/channel).
  - JobQueueService: quản lý hàng đợi, trạng thái, log, cancel.
- **Infrastructure**:
  - File system access (fs/path).
  - Process spawning (child_process) cho ffmpeg/ffprobe/yt-dlp/exiftool/ps.
  - Logging (stdout/stderr capture).
  - Configuration (đường dẫn tool, folder mặc định, template naming).

## Giao tiếp & IPC
- Renderer gọi IPC invoke qua preload: scanMusicFolders, createPlaylists, video:cutSingleSimple, video:mergeSimple, video:final-export:scan-*, video:seo:apply, youtube:downloadVideo/Channel, system/dialog helpers.
- Progress channel: `music:exportProgress`, `video:progress`, `VIDEO_FINAL_EXPORT_*`, `youtube:progress`, `youtube:batch-progress`.
- Metadata SEO: renderer gửi `SeoMetadataRequest` → main → `applySeoMetadata` (exiftool + PowerShell).

## Data flow tiêu biểu
### Scan thư mục nhạc
1) UI chọn thư mục → IPC `scanMusicFolders`.
2) Main gọi MediaScanService: read dir, filter ext, spawn ffprobe (concurrency), trả JSON metadata.
3) Renderer nhận kết quả, hiển thị thống kê/preview.

### Cắt & ghép video
1) UI nhập file/timecode → IPC `video:cutSingleSimple`.
2) VideoProcessingService spawn ffmpeg `-f segment -c copy`, parse stderr `time=` → progress emit `video:progress`.
3) Ghép: concat list, ffmpeg copy-stream, progress tương tự.

### Tải YouTube → convert audio
1) UI validate URL → `youtube:validateUrl`, get info `youtube:getVideoInfo`.
2) Download: spawn yt-dlp với format (best <= height hoặc audio-only), parse `[download]` → progress events.
3) (Nếu cần) convert audio bằng ffmpeg sau khi tải xong.

### SEO metadata (exiftool trước, PowerShell sau)
1) UI gửi `SeoMetadataRequest` (mode title/genre, channel, url, preset...).  
2) Main gọi MetadataService → build arg-file UTF-8, chạy exiftool trên bản copy → copy đè file gốc (ghi toàn bộ tag Title/Subject/Comment/Keywords/Rating/Genre/Origin/Content...).  
3) Nếu Windows: chạy PowerShell COM `Shell.Application` set 4 field Explorer (Title=21, Subject=22, Comment=24, Rating=19 nhận “0..5”; Subtitle: tìm cột “Subtitle”, fallback Subject).  
4) Explorer thấy Title/Comment/Subject/Rating; các tag còn lại lưu trong file (xem bằng exiftool/ứng dụng khác).

## Xử lý lỗi & logging
- Mọi child_process được capture stdout/stderr; log tóm tắt gửi renderer.
- Error hiển thị trực tiếp (stderr đầu tiên) + mã job.
- JobQueueService: trạng thái pending/running/success/failed; cancel → kill process.

## Bảo mật & sandbox
- Renderer bị sandbox; chỉ preload expose API cần thiết.
- Các thao tác ghi file/path phải qua IPC.
- Không chạy lệnh tùy ý từ renderer; command string được build tại backend.

## Cấu hình (config)
- Đường dẫn tool: ffmpeg/ffprobe/yt-dlp/exiftool (bundle `bin/`), có thể override qua config/env.
- Thư mục mặc định: music source, video source, output folder.
- Template đặt tên: playlist export, output video/audio, arg-file exiftool SEO.
