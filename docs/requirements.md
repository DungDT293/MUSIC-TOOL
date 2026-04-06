# Requirements (SRS/BRD) — 93 Media Tool v4.0.2

> Cập nhật lần cuối: 2026-04-02

---

## Mục tiêu hệ thống

Ứng dụng desktop hỗ trợ **toàn bộ pipeline sản xuất media**: quét nhạc → playlist → mix audio → nâng cấp âm thanh → tạo sóng nhạc (visualizer) → cắt/ghép video → SEO metadata → xuất video hoàn chỉnh → tải YouTube → autopilot batch. Kèm theo hệ thống bảo mật, license, và auto-update.

## Phạm vi

- Người dùng cá nhân/creator cần quản lý nhiều file audio/video, thao tác batch, tối ưu SEO trước khi upload.
- Nền tảng chính: Windows 10/11. macOS/Linux experimental.

## Persona

| Persona | Nhu cầu |
|---------|---------|
| **YouTuber / Content Creator** | Cắt/ghép nhanh, chỉnh metadata SEO, tải nguồn từ YouTube, xuất video hoàn chỉnh |
| **Người chơi nhạc / DJ** | Quét thư viện, tạo playlist, mix audio với crossfade, tạo visualizer sóng nhạc |
| **Editor video** | Cắt/ghép, normalize, mute audio, GPU encoding |
| **Nhà sản xuất nội dung tự động** | Autopilot batch: quét nhạc → playlist → export → video tự động |

---

## Yêu cầu chức năng

### 1. Music Library & Playlist
- Quét thư mục/ổ đĩa (priority + random folders), đọc metadata (bitrate, duration, tags) bằng ffprobe → lưu kết quả scan
- Tạo/sửa/xóa playlist; thêm pinned track; phân loại theo nghệ sĩ/album/genre/folder
- Xuất playlist: m3u/json; xuất audio MP3/WAV với crossfade (có validation trước export)
- Lịch sử playlist đã xuất, tra cứu thời gian
- Music pool usage tracking (thống kê track đã dùng)

### 2. Nâng cấp âm thanh (EnhanceAudio)
- EQ 5-band (Highpass, Bass, Mid, Treble, Lowpass)
- Compressor (Threshold, Ratio, Attack, Release, Makeup Gain, dry/wet mix)
- EBU R128 Loudnorm (LUFS, True Peak, LRA) — streaming/youtube/broadcast/club presets
- Stereo Widener (M/S processing)
- Noise Gate (Threshold, Ratio, Attack, Release, Range)
- True-peak Limiter (Threshold, Attack, Release)
- Harmonic Exciter (Freq, Amount, Drive, Blend)
- Noise Reduction (Reduce dB, Noise Floor)
- Real-time preview qua Web Audio API chain
- Built-in + user-saved processing presets

### 3. Sóng nhạc (Music Visualizer)
- **Layer editor**: Image, Text, Visualizer, Video, Group layers
  - Mỗi layer có transform (x/y/scale/rotation/flip), filter (14 CSS-style properties), time range (intro/outro với fade)
  - Layer roles: normal, watermark, intro, outro
- **6 Visualizer engines**: Three.js (3D bars + bloom), Butterchurn (MilkDrop), AudioMotion (spectrum), WaveJS, Vanta.js (3D bg), WaveBars (2D fallback)
- **10 wave styles**: bars, line, ring, dots, waveform, circlebars, plasma, lightning, galaxy, fire
- **GizmoOverlay**: Drag/resize/rotate layers trên canvas, alignment snap, grid snap, multi-select
- **Timeline**: Waveform peaks + beat detection via Web Worker, playhead seek, zoom
- **Undo/Redo**: 50-step history
- **Templates**: Save/load full layer layouts
- **Built-in presets**: 10 preset visualizer
- **Export**: Deterministic frame-by-frame → FFmpeg stdin pipe
  - Quality presets: low (640×360), medium (1280×720), full (1920×1080 60fps), 2K (2560×1440)
  - 9 aspect ratios: 16:9, 4:3, 1:1, 9:16, 4:5, 2.35:1, 2:1, 1.85:1, 3:4
  - GPU encoding (NVENC/AMF) với CPU fallback
  - File size estimation trước export

### 4. Video Editing & Processing
- Cắt đoạn theo timecode (single/multi-segment); cắt nhiều file (batch)
- Ghép nhiều clip (concat copy-stream/re-encode); shuffle/duration limit; cảnh báo codec mismatch
- Mute audio (strip audio from video)
- Normalize video (resolution + FPS)
- Final export audio-video 1-1: scan nguồn, match số lượng, encode/concat
- GPU encoding choice: NVENC (NVIDIA), AMF (AMD), VideoToolbox (macOS), CPU fallback
- Video audit: batch probe + validate files
- Video pool LRU management (cho autopilot)

### 5. Metadata & SEO
- Chỉnh title/subject/comment/keywords, rating, origin, content fields
- Ghi metadata thật bằng exiftool (UTF-8 full Unicode: Vietnamese, Chinese, Japanese)
- AtomicParsley: ghi iTunes atoms cho MP4
- Windows: set 4 field Explorer (Title/Subject/Comment/Rating) bằng PowerShell COM
- Hỗ trợ preset kênh/URL/genre; tracklist auto nếu audio khớp

### 6. YouTube Downloader
- Tải video/playlist/channel (yt-dlp)
- Chọn chất lượng (best ≤ height), audio-only; subtitle/thumbnail embed
- Channel batch download với concurrent limit
- Info video/channel, ước lượng dung lượng; continue on error
- Auto-update yt-dlp trên startup, age warning >15 ngày
- Browser cookie extraction cho age-restricted videos
- Tracklist detection từ video description

### 7. Autopilot (Batch Automation)
- Pipeline tự động: quét nhạc → tạo playlist → export audio → ghép video → final export
- Batch config: Tomorrowland/Party Mix/Custom presets
- Video pool LRU management
- Real-time status monitoring + log
- Cancel bất cứ lúc nào

### 8. Audio/Subtitle (AI)
- Whisper transcribe (local, @xenova/transformers)
- Faster Whisper (Python subprocess, CUDA GPU support)
- Subtitle generator từ transcription

### 9. Auth & License
- Register/login 5-state machine (unregistered → pending → allowed → blocked → error)
- Encrypted credential storage (AES-256-GCM + PBKDF2 300k iterations)
- Machine-ID binding (SHA-256 hardware identifiers)
- Online license verification (Cloudflare Workers)
- Activation key flow
- JWT device token + refresh token
- Offline fallback (24h TTL graceful degradation)
- Allow-rebind khi thay đổi phần cứng

### 10. Auto-update
- electron-updater integration
- stable/beta channel switching
- Version gating: allow / block-old (auto-update) / block-version (forced download)
- Version policy từ server (latest, min supported, blocked versions)

### 11. Batch Processing & Job Queue
- Mọi tác vụ đưa vào hàng đợi: pending → running → success/failed; có cancel
- Ghi log stderr/stdout cho từng job; hiển thị progress/ETA
- Video job manager: track active jobs, cancel by request ID

### 12. System Monitoring
- Live stats: CPU%, GPU%, disk read/write MBps (1s poll)
- SSD/HDD total/free aggregated (30s poll)
- Disk space error modal (non-dismissible)
- Offline license banner
- Account block banner

### 13. Settings & Configuration
- Đường dẫn tool (ffmpeg/ffprobe/yt-dlp/exiftool/AtomicParsley) auto-detect từ `bin/`
- Thư mục mặc định cho nguồn/output
- Template đặt tên output
- Feature flags (`HIDE_FEATURE_AUTOPILOT`)
- GPU/CPU encoding preference
- Update channel (stable/beta)

---

## Yêu cầu phi chức năng

### Hiệu năng
- Xử lý batch hàng chục/hàng trăm file; concurrency giới hạn (concurrent task executor với producer-consumer pattern)
- Keep-alive router: không unmount pages khi chuyển tab → preserve state
- Web Worker cho waveform/beat detection (downsample audio >15 phút tránh OOM)
- File size estimation trước export

### Bảo mật
- Renderer sandbox: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- CSP headers (production)
- Encrypted auth store (AES-256-GCM, PBKDF2 300k iterations)
- HMAC-SHA256 request signing (timestamp + nonce + machine-ID)
- Login rate limiting
- Anti-debug + tamper detection + environment detection
- Auto-block engine (server-side)
- Path validation (null byte, absolute path enforcement)
- Zod input validation cho mọi IPC payload

### Độ tin cậy
- Error boundary (React) + crash recovery (auto-reload renderer)
- FFmpeg graceful kill on app quit
- GPU→CPU fallback khi NVENC/AMF fail
- 8s fail-open timeout cho version gating
- Retry hợp lý, không crash khi tool ngoài trả lỗi

### UX
- Live hardware stats trong TopBar
- Progress/ETA cho mọi tác vụ dài
- Collapsible sidebar (250px↔72px, persisted)
- Toast notifications cho auto-update, yt-dlp update
- Keyboard shortcuts cho visualizer editor
- Alignment guides + grid snap cho GizmoOverlay

### Mở rộng
- Plugin-ready engine system (thêm visualizer engine mới)
- Feature flags cho toggle tính năng
- Export presets customizable
- Template system cho visualizer layouts

---

## Use case / Flow mẫu

### DJ Workflow (Autopilot)
1. Cấu hình batch preset (Tomorrowland/Party Mix/Custom)
2. Autopilot quét nhạc → tạo playlist → export audio crossfade → ghép video → final export
3. Monitor progress real-time, cancel nếu cần

### Music Visualizer Workflow
1. Chọn audio file → load waveform/beat timeline
2. Add layers: background image, visualizer (wave style), text overlay, watermark
3. Configure engine (Three.js/Butterchurn/AudioMotion/etc.)
4. Preview real-time → adjust filters, transform, timing
5. Export video (GPU preferred, CPU fallback)

### YouTube Content Creator
1. Tải nguồn từ YouTube → cắt đoạn cần thiết
2. Ghép clips → normalize → final export
3. Apply SEO metadata (title, keywords, description)
4. Upload

### Audio Production
1. Quét thư viện nhạc → tạo playlist
2. Enhance audio: EQ → Compressor → Loudnorm → Limiter
3. Preview real-time → export audio
