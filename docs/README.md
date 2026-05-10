# 93 Media Tool — Mix Nhạc v4.2.4

Ứng dụng desktop chuyên xử lý media (nhạc + video) viết bằng TypeScript, chạy trên Electron với UI React. Hỗ trợ đầy đủ pipeline: quét nhạc → playlist → mix audio → visualizer sóng nhạc → cắt/ghép video → SEO metadata → xuất video hoàn chỉnh → tải YouTube.

> Cập nhật lần cuối: 2026-04-02 · Phiên bản: **4.0.2**

---

## Tổng quan tính năng

| # | Tính năng | Mô tả |
|---|-----------|-------|
| 1 | **Quét nhạc** | Quét thư mục, đọc metadata (bitrate, duration, tags) bằng ffprobe |
| 2 | **Tạo Playlist** | Tạo/sửa/xóa playlist, export m3u/json, crossfade validation |
| 3 | **Nghe thử Playlist** | Preview playlist trước khi xuất |
| 4 | **Xuất nhạc** | Export audio MP3/WAV với crossfade, lưu lịch sử export |
| 5 | **Cắt/Ghép Video** | Cắt đoạn (single/multi), ghép clip (concat), mute audio, normalize resolution/FPS |
| 6 | **Xuất video hoàn chỉnh** | Final export pipeline: scan audio + video → ghép 1-1 → encode |
| 7 | **YouTube Downloader** | Tải video/audio từ YouTube qua yt-dlp, hỗ trợ channel batch download |
| 8 | **Nâng cấp âm thanh** | EQ 5-band, Compressor, Limiter, Noise Gate, Stereo Widener, Exciter, Noise Reduction, EBU R128 Loudnorm, presets |
| 9 | **Autopilot** | Tự động hoá DJ set: quét nhạc → tạo playlist → export audio → ghép video hoàn chỉnh theo batch |
| 10 | **Sóng nhạc (Visualizer)** | Music visualizer đa engine (Three.js, Butterchurn, AudioMotion, WaveJS, Vanta), layer editor, timeline, export video |
| 11 | **SEO Metadata** | Ghi title/description/keywords vào video qua exiftool + AtomicParsley (iTunes atoms) |
| 12 | **Cài đặt** | GPU/CPU encoding, auto-update (stable/beta channel), feature flags |

---

## Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer (React 18 + Zustand + Vite)                          │
│  Pages: ScanMusic → Playlist → Preview → Export → CutMerge     │
│         → FinalExport → YouTube → EnhanceAudio → Autopilot     │
│         → SongNhac (Visualizer) → Settings                     │
├─────────────────────────────────────────────────────────────────┤
│  Preload (contextBridge, sandbox: true)                        │
│  window.api.{license, auth, music, video, youtube, songNhac,   │
│              autopilot, preset, jobQueue, updater, policy,      │
│              security, dialog, system, videoFinalExport}        │
├─────────────────────────────────────────────────────────────────┤
│  Main Process (Electron 36, Node.js)                           │
│  IPC Handlers → Backend Services → External Tools              │
├─────────────────────────────────────────────────────────────────┤
│  Backend Services                                              │
│  audio/ auth/ autopilot/ ffmpeg/ jobQueue/ license/ music/     │
│  security/ system/ utils/ video/ youtube/                      │
├─────────────────────────────────────────────────────────────────┤
│  External Tools (bin/)                                         │
│  ffmpeg · ffprobe · yt-dlp · exiftool · AtomicParsley          │
├─────────────────────────────────────────────────────────────────┤
│  Server (Cloudflare Workers + D1)                              │
│  Auth API · License Management · Version Policy · Dashboard    │
│  Security Events · Auto-block Engine · JWT Device Tokens       │
└─────────────────────────────────────────────────────────────────┘
```

- **3-tier Electron**: Renderer (React) ↔ Preload (contextBridge) ↔ Main (Node.js)
- **Sandbox enabled**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- **Keep-alive router**: Tất cả pages mount 1 lần, toggle `display:none` — giữ nguyên state khi chuyển tab
- Chi tiết xem [`architecture.md`](./architecture.md)

---

## Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| **Frontend** | React 18.3, TypeScript, Vite, Zustand (state management), Zod (validation) |
| **Desktop** | Electron 36, electron-vite 5, electron-builder, electron-updater |
| **Visualizer** | Three.js + UnrealBloomPass, Butterchurn (MilkDrop), AudioMotion-Analyzer, Wave.js, Vanta.js, Canvas 2D |
| **Canvas** | Custom CanvasHost (dual WebGL+Canvas2D), Konva (legacy), GizmoOverlay (drag/scale/rotate) |
| **Audio** | Web Audio API (EQ, Compressor, Limiter, Stereo Widener, Analyser), FFT real-time |
| **Backend** | Node.js (fs/path/child_process/os), FFmpeg, FFprobe, yt-dlp, exiftool, AtomicParsley |
| **Server** | Cloudflare Workers, D1 (SQLite), KV (nonce store), R2 (file storage) |
| **Security** | AES-256-GCM, PBKDF2 (300k iterations), HMAC-SHA256 request signing, JWT device tokens, CSP headers |
| **AI/ML** | Whisper (faster-whisper/CUDA) cho subtitle/lyrics |

---

## Hệ thống bảo mật

- **Encrypted Auth Store**: Credentials lưu mã hoá AES-256-GCM trên disk
- **PBKDF2 Key Derivation**: 300,000 iterations (NIST 2023 compliant)
- **Request Signing**: Mọi API call được ký HMAC-SHA256 với timestamp + nonce
- **Rate Limiting**: Login rate limiter per-username, nonce dedup
- **Anti-debug**: DevTools detection, timing anomaly, F12/Ctrl+Shift+I block (production)
- **Tamper Detection**: Hash check + environment detection (VM/sandbox)
- **Auto-block Engine**: Server tự block machine ID khi phát hiện bất thường (nonce reused, signature invalid, tampering)
- **Version Gating**: 3-tier (allow / block-old / block-version) với auto-update flow
- **CSP Headers**: Restrictive Content-Security-Policy trong production

---

## Sóng nhạc (Music Visualizer)

Hệ thống visualizer đa engine với layer editor kiểu After Effects:

### Layer Types
- **Image Layer**: Upload ảnh, fit mode (free/contain/cover), wave-around effect, intro/outro time range, CSS filters
- **Text Layer**: Custom text, font, size, color, stroke, shadow
- **Visualizer Layer**: 10 wave styles (bars, line, ring, dots, waveform, circlebars, plasma, lightning, galaxy, fire)
- **Video Layer**: Video background, mute/loop, volume control
- **Group Layer**: Nhóm layers lại, di chuyển/scale cùng lúc

### Engines
| Engine | Mô tả |
|--------|-------|
| Three.js | 3D bars + UnrealBloomPass, circular/horizontal/mirror layout |
| Butterchurn | MilkDrop WebGL presets |
| AudioMotion | Spectrum analyzer, radial mode, LED bars |
| Wave.js | Multi-style wave animations |
| Vanta.js | 3D animated backgrounds (waves, birds, etc.) |
| WaveBars | Simple Canvas 2D fallback |

### Editor Features
- **GizmoOverlay**: Drag/resize/rotate layers trên canvas, alignment guides (snap cyan), grid snap
- **Timeline**: Waveform peaks + beat detection (Web Worker), playhead seek
- **Undo/Redo**: 50-step history stack
- **Templates**: Save/load full layer layout presets
- **Built-in Presets**: 10 preset (Neon Circle, Fire Bars, Minimal Line, Retro Spectrum, Galaxy Spin, etc.)
- **Export**: Deterministic frame-by-frame render → FFmpeg stdin pipe, hỗ trợ GPU (NVENC/AMF) với CPU fallback
- **Aspect Ratios**: 16:9, 4:3, 1:1, 9:16, 4:5, 2.35:1, 2:1, 1.85:1, 3:4
- **Quality Presets**: low (640×360), medium (1280×720), full (1920×1080 60fps), 2K (2560×1440)

---

## Nâng cấp âm thanh (EnhanceAudio)

Xử lý audio chuyên nghiệp với real-time preview qua Web Audio API:

| Module | Chức năng |
|--------|-----------|
| **EQ 5-band** | Highpass, Bass, Mid, Treble, Lowpass |
| **Compressor** | Threshold, Ratio, Attack, Release, Makeup Gain (dry/wet mix) |
| **Loudnorm** | EBU R128 normalization (LUFS, True Peak, LRA) |
| **Stereo Widener** | M/S stereo processing |
| **Noise Gate** | Threshold, Ratio, Attack, Release, Range |
| **Limiter** | True-peak limiter (Threshold, Attack, Release) |
| **Exciter** | Harmonic exciter (Freq, Amount, Drive, Blend) |
| **Noise Reduction** | Reduce dB, Noise Floor |
| **Presets** | Built-in + user-saved processing presets |

---

## Autopilot

Chế độ tự động hoá hoàn toàn cho sản xuất DJ set hàng loạt:

1. Quét nhạc từ thư mục → Tạo playlist tự động
2. Export audio với crossfade
3. Ghép video clips (LRU pool management) → Final export
4. Lặp lại theo batch config (Tomorrowland/Party Mix/Custom presets)

Monitor pool trạng thái real-time, cancel bất cứ lúc nào.

---

## Yêu cầu hệ thống

- **OS**: Windows 10/11 (primary), macOS/Linux (experimental)
- **Node.js**: >= 18
- **RAM**: >= 4GB (khuyến nghị 8GB+ cho visualizer export)
- **GPU**: Tuỳ chọn — NVENC (NVIDIA) / AMF (AMD) cho GPU encoding
- **Disk**: SSD khuyến nghị cho export performance
- **External tools**: Bundle trong `bin/` (ffmpeg, ffprobe, yt-dlp, exiftool, AtomicParsley)

---

## Cài đặt & chạy

```bash
git clone <repo>
cd <repo>
npm install

# Dev
npm run dev

# Build release (installer + portable)
npm run build:app

# Build chỉ Windows installer
npm run build:win-installer

# Build Windows portable
npm run build:win-portable
```

Cấu hình (nếu cần) đặt trong `.env` hoặc file config tùy môi trường.

---

## Cấu trúc thư mục

```
93-media-tool-mix-nhac/
├── src/                    # Renderer (React 18)
│   ├── pages/              # Auth, Music, Video, Autopilot, Settings
│   ├── features/song-nhac/ # Music Visualizer (core feature)
│   ├── components/         # Sidebar, TopBarStats, ErrorBoundary, etc.
│   ├── config/             # Feature flags
│   └── security/           # Anti-debug (renderer side)
├── backend/                # Node.js services
│   ├── audio/              # Whisper subtitle, transcribe
│   ├── auth/               # Encrypted auth store, session manager
│   ├── autopilot/          # Autopilot runner, video pool
│   ├── ffmpeg/             # FFmpeg config, probe, wrapper
│   ├── jobQueue/           # Job queue service
│   ├── license/            # License manager, online service, tickets
│   ├── music/              # Scan, playlist, export, normalize, enhance, Spotify meta
│   ├── security/           # Anti-debug, API signing, rate limiter, tamper detection
│   ├── system/             # Disk info, realtime stats, sysinfo
│   ├── utils/              # Cache cleanup, disk space, GPU detection, path utils
│   ├── video/              # Cut, merge, split, mute, normalize, final export, SEO
│   └── youtube/            # YouTube downloader, cookie service, tracklist detector
├── electron/               # Main process (main.ts, preload.ts, handlers/)
├── shared/                 # Shared types, IPC schemas (Zod), password validator
├── server/                 # Cloudflare Worker (license, auth, dashboard, security)
├── bin/                    # ffmpeg.exe, ffprobe.exe, yt-dlp.exe, exiftool.exe, AtomicParsley.exe
├── scripts/                # Build, test, backup scripts
├── security/               # Public/private keys
└── docs/                   # Tài liệu
```

---

## Tài liệu liên quan

| File | Nội dung |
|------|----------|
| [`architecture.md`](./architecture.md) | Kiến trúc hệ thống, IPC channels, data flow |
| [`requirements.md`](./requirements.md) | Yêu cầu chức năng & phi chức năng |
| [`FEATURES_GUIDE.md`](./FEATURES_GUIDE.md) | Hướng dẫn chi tiết từng tính năng |
| [`external-tools.md`](./external-tools.md) | Cách gọi ffmpeg/ffprobe/yt-dlp/exiftool |
| [`FUNCTIONALITY_TEST_REPORT.md`](./FUNCTIONALITY_TEST_REPORT.md) | Báo cáo test từng feature |
| [`security/SECURITY_PLAN.md`](./security/SECURITY_PLAN.md) | Kế hoạch & trạng thái bảo mật |
| [`guides/LICENSE_WORKFLOW.md`](./guides/LICENSE_WORKFLOW.md) | Luồng license (register → approve → ticket) |
| [`guides/GPU_CPU_ENCODING_PLAN.md`](./guides/GPU_CPU_ENCODING_PLAN.md) | GPU/CPU encoding implementation |
| [`guides/ATOMICPARSLEY_SETUP.md`](./guides/ATOMICPARSLEY_SETUP.md) | Cài đặt AtomicParsley cho iTunes atoms |
| [`dashboard/DASHBOARD_STATUS.md`](./dashboard/DASHBOARD_STATUS.md) | Trạng thái Admin Dashboard |

---

## Contributing

- Fork và tạo nhánh tính năng
- Giữ code TypeScript/ESLint format chuẩn
- Mô tả thay đổi trong PR, kèm ảnh chụp UI (nếu liên quan)

## License & Liên hệ

Email: dungdong333@gmail.com
SĐT/Zalo: 0393954568
