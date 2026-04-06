# Hướng dẫn tính năng — 93 Media Tool v4.0.2

> Cập nhật: 2026-04-02

Tài liệu này mô tả chi tiết các tính năng chính. Xem [`README.md`](./README.md) cho tổng quan và [`architecture.md`](./architecture.md) cho IPC/API.

---

## Mục lục

1. [Quét nhạc & Playlist](#1-quét-nhạc--playlist)
2. [Nâng cấp âm thanh (EnhanceAudio)](#2-nâng-cấp-âm-thanh-enhanceaudio)
3. [Sóng nhạc — Music Visualizer](#3-sóng-nhạc--music-visualizer)
4. [Video Tools](#4-video-tools)
5. [YouTube Downloader](#5-youtube-downloader)
6. [Autopilot](#6-autopilot)
7. [Subtitle / Lyrics (Whisper AI)](#7-subtitle--lyrics-whisper-ai)
8. [SEO Metadata](#8-seo-metadata)
9. [Auth & License](#9-auth--license)
10. [Auto-update & Version Gating](#10-auto-update--version-gating)

---

## 1. Quét nhạc & Playlist

### Luồng sử dụng
1. **Quét nhạc** → Chọn thư mục (priority + random) → FFprobe scan recursive → kết quả metadata
2. **Tạo Playlist** → Kéo thả bài, sắp xếp, pin tracks → Fisher-Yates shuffle
3. **Nghe thử** → Preview player
4. **Xuất nhạc** → Export MP3/WAV, crossfade validation, lưu lịch sử

### IPC channels
```
music:scanFolders → music:createPlaylists → music:exportPlaylist
music:getExportHistory → music:deleteExportHistory
music:getPoolStats → music:clearPool
```

### Spotify metadata
- `music:spotifyMeta(url)` — lấy track info từ Spotify URL
- File: `backend/music/spotifyMeta.ts`

---

## 2. Nâng cấp âm thanh (EnhanceAudio)

### Kiến trúc

```
Audio File → [Web Audio API Preview Chain] → Speaker
                  │
                  ├─ EQ (5-band: highpass/bass/mid/treble/lowpass)
                  ├─ Compressor (threshold/ratio/attack/release/makeup, dry/wet)
                  ├─ Stereo Widener (M/S processing)
                  ├─ Limiter (true-peak)
                  └─ Analyser (visualize)
                  
Audio File → [FFmpeg Backend Processing] → Output File
                  │
                  ├─ EQ (via FFmpeg filters)
                  ├─ Compressor
                  ├─ Loudnorm (EBU R128: LUFS/TruePeak/LRA)
                  ├─ Noise Gate
                  ├─ Noise Reduction
                  ├─ Exciter (harmonic generation)
                  └─ Limiter
```

### Modules
| Component | File | Mô tả |
|-----------|------|-------|
| Main orchestrator | `src/pages/Music/EnhanceAudio/index.tsx` | Quản lý toàn bộ pipeline |
| Web Audio chain | `src/pages/Music/EnhanceAudio/useAudioChain.ts` | Real-time preview (StrictMode safe) |
| EQ Panel | `EQPanel.tsx` | 5-band slider UI |
| Compressor Panel | `CompressorPanel.tsx` | Dynamics controls |
| Loudnorm Panel | `LoudnormPanel.tsx` | EBU R128 presets: streaming/youtube/broadcast/club |
| Stereo Panel | `StereoPanel.tsx` | M/S width control |
| Noise Gate Panel | `NoiseGatePanel.tsx` | Gate controls |
| Limiter Panel | `LimiterPanel.tsx` | True-peak limiter |
| Exciter Panel | `ExciterPanel.tsx` | Harmonic exciter |
| Noise Reduction Panel | `NoiseReductionPanel.tsx` | Reduce + floor controls |
| Presets Panel | `PresetsPanel.tsx` | Load/save presets |
| Built-in presets | `presets.ts` | Preset definitions |

### IPC channels
```
music:enhance:run → music:enhance:progress → music:enhance:cancel
music:enhance:renderPreview
```

---

## 3. Sóng nhạc — Music Visualizer

### Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────┐
│  SongNhacScreen                                         │
│  ├─ VisualizerToolbar (quality, aspect, zoom, export)   │
│  ├─ VisualizerLayout                                    │
│  │   ├─ LayersPanel (left) — layer list, presets, templates │
│  │   ├─ PreviewViewport (center) — canvas + GizmoOverlay│
│  │   └─ InspectorPanel (right) — transform, filter, text│
│  ├─ TimelineView (bottom) — waveform, beats, playhead   │
│  ├─ TransportBar — play/pause/seek                      │
│  └─ AudioSourceSelector — pick from playlist / drag-drop│
└─────────────────────────────────────────────────────────┘
```

### Runtime (non-React)
| File | Vai trò |
|------|---------|
| `VisualizerRuntime.ts` | RAF loop, FFT pull, engine switching, canvas composite |
| `AudioAnalyzerRealtime.ts` | AudioContext + AnalyserNode, frequency/waveform data |
| `CanvasHost.ts` | Dual canvas (WebGL bg + Canvas2D fg) |
| `EngineHost.ts` | Multi-engine lifecycle, hot-swap |
| `drawLayers.ts` | Draw all DrawableLayer objects |
| `renderOneFrame.ts` | Shared render function (Preview ≡ Export) |

### 6 Engines
| Engine | Type | Key Feature |
|--------|------|-------------|
| Three.js | WebGL | 3D bars + UnrealBloomPass, 3 layouts |
| Butterchurn | WebGL | MilkDrop presets |
| AudioMotion | WebGL | Spectrum, radial, LED modes |
| Wave.js | WebGL | Multi-style animations |
| Vanta.js | WebGL | 3D animated backgrounds |
| WaveBars | Canvas 2D | Simple fallback |

### 10 Wave Styles
`bars · line · ring · dots · waveform · circlebars · plasma · lightning · galaxy · fire`

### Layer System
- 5 types: Image, Text, Visualizer, Video, Group
- Transform: x, y, scaleX, scaleY, rotation, flipX, flipY
- Filter: 14 CSS-style properties (opacity, brightness, contrast, blur, tint, shadow, etc.)
- TimeRange: startSec, endSec, fadeInSec, fadeOutSec
- Roles: normal, watermark (always-on-top 25% scale), intro, outro

### GizmoOverlay
- Hit-test → drag to move/resize/rotate
- Multi-select (Ctrl+click, Shift+range)
- Alignment guides (cyan snap lines)
- Grid snap (50px)
- Group bounds outline
- Double-click text → focus Inspector input

### Timeline
- Waveform peaks + beat detection via Web Worker
- Downsample to 15min max (prevent OOM)
- Zoom, scroll, playhead seek
- Beat markers

### Export Pipeline
```
ExportRuntime (deterministic loop, no RAF)
  → renderOneFrame() per frame
  → captureFrame() → JPEG blob
  → IPC song-nhac:frame → FFmpeg stdin pipe
  → Output video file
```
- GPU: NVENC/AMF with CPU fallback
- Quality presets: low/medium/full/2K
- Aspect ratios: 9 options
- File size estimation

### Stores (Zustand)
| Store | Purpose |
|-------|---------|
| `songNhacLayerStore` | Layers, selection, clipboard, undo/redo (50 steps), groups |
| `songNhacAudioStore` | Audio URL, duration, display name |
| `songNhacRuntimeStore` | Quality, FPS, aspect ratio, zoom, engine config, bloom, bg mode |
| `songNhacExportStore` | Export progress, dialog state, GPU→CPU retry |
| `songNhacTimelineStore` | Waveform/beat data, zoom, scroll, playhead |
| `songNhacTemplateStore` | User-saved layout templates (localStorage) |

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Delete / Backspace | Remove selected layers |
| Esc | Deselect all |
| Ctrl+C | Copy |
| Ctrl+V | Paste |
| Ctrl+D | Duplicate |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |

---

## 4. Video Tools

### Tabs trong CutMergeVideoPage

| Tab | File | Chức năng |
|-----|------|-----------|
| Single Cut | `SingleCutTabSimple.tsx` | Cắt 1 video theo timecode |
| Multi Cut | `MultiCutTab.tsx` | Cắt nhiều đoạn từ nhiều video |
| Merge | `MergeTab.tsx` | Ghép clips (concat demuxer hoặc re-encode) |
| Mute Audio | `MuteAudioTab.tsx` | Xoá audio khỏi video |
| Normalize | `NormalizeVideoTab.tsx` | Chuẩn hoá resolution/FPS |
| Audit Files | `AuditFilesTab.tsx` | Validate video files (batch probe) |

### GPU Encoding
- Auto-detect: `gpuDetection.ts` → NVENC (NVIDIA) / AMF (AMD) / VideoToolbox (macOS)
- UI checkboxes trong các tab
- `buildVideoEncoderArgsWithChoice()` builds ffmpeg args
- Fallback to CPU nếu GPU fail

### Final Export
- Scan audio + video sources → match 1-1
- Re-encode with audio mix
- IPC: `video:final-export:request` (fire-and-forget) → progress/done/error events

### Video Pool (LRU)
- `video:pool-mark-used` — mark clips as used
- `video:pool-pick-lru` — pick least-recently-used clips
- Dùng cho Autopilot batch automation

---

## 5. YouTube Downloader

### Features
- Single video / channel batch download
- Format selection: best ≤ height, audio-only
- Channel info: video list, estimated size
- Progress tracking real-time
- Cancel support

### Đặc biệt
- **Auto-update yt-dlp** trên startup; warning nếu binary > 15 ngày
- **Browser Cookie Service** (`browserCookieService.ts`): extract cookies từ Chrome/Edge cho age-restricted videos
- **Tracklist Detector** (`tracklistDetector.ts`): tự động detect tracklist trong video description
- **Safe Folder Manager** (`SafeFolderManager.ts`): quản lý thư mục output an toàn

---

## 6. Autopilot

### Pipeline

```
┌──────────────────────────────────────────────────────┐
│  autopilotRunner.ts                                   │
│                                                       │
│  Step 1: Quét nhạc (music:scanFolders)               │
│  Step 2: Tạo playlist (music:createPlaylists)        │
│  Step 3: Export audio (music:exportPlaylist)          │
│  Step 4: Ghép video clips (video:final-export)       │
│  Step 5: Lặp lại theo batch config                   │
│                                                       │
│  State: idle → running → done / error                │
│  Cancel: bất cứ lúc nào                              │
└──────────────────────────────────────────────────────┘
```

### UI Tabs
| Tab | File | Mô tả |
|-----|------|-------|
| Batch Mode | `BatchModeTab.tsx` | Presets: Tomorrowland / Party Mix / Custom |
| Pool Monitor | `PoolMonitorTab.tsx` | Real-time video pool stats |

### Feature Flag
`HIDE_FEATURE_AUTOPILOT` trong `src/config/featureFlags.ts` — toggle autopilot visibility (sidebar + route)

### IPC
```
autopilot:start(config) → autopilot:status → autopilot:log
autopilot:cancel → autopilot:getStatus
autopilot:scan-video-folders → autopilot:video-pool-stats → autopilot:video-pool-clear
```

---

## 7. Subtitle / Lyrics (Whisper AI)

### Backend modules
| File | Mô tả |
|------|-------|
| `backend/audio/whisperTranscribe.ts` | Whisper inference via `@xenova/transformers` (local, CPU) |
| `backend/audio/whisperFasterService.ts` | Python subprocess — `faster-whisper` with CUDA GPU support |
| `backend/audio/subtitleGenerator.ts` | Generate subtitle/lyrics from transcription output |

### Luồng
1. Audio file → Whisper (local hoặc GPU) → transcription JSON
2. Transcription → subtitleGenerator → SRT/VTT/text output

---

## 8. SEO Metadata

### Pipeline

```
User chọn video → Nhập metadata (title, description, keywords, genre, rating)
  │
  ├─ exiftool: Ghi metadata vào file (UTF-8 full Unicode)
  │   ├─ Vietnamese, Chinese, Japanese, Indonesian supported
  │   └─ Arg-file method (-@ flag) for reliable encoding
  │
  ├─ AtomicParsley: Ghi iTunes atoms cho MP4
  │   └─ Setup: xem ATOMICPARSLEY_SETUP.md
  │
  └─ PowerShell (Windows only): Set 4 field Windows Explorer
      ├─ Title (index 21)
      ├─ Subject (index 22)
      ├─ Comment (index 24)
      └─ Rating (index 19, scale 0-5)
```

### Files
| File | Vai trò |
|------|---------|
| `backend/video/seoMetadata.ts` | Main SEO pipeline |
| `guides/SEO_METADATA_CODE_ANALYSIS.md` | Code analysis chi tiết |
| `guides/SEO_UNICODE_SUPPORT.md` | Unicode support details |
| `guides/ATOMICPARSLEY_SETUP.md` | AtomicParsley installation guide |

---

## 9. Auth & License

### State Machine
```
unregistered → (register) → pending → (admin approve) → allowed
                                    → (admin block)   → blocked
allowed → (login) → allowed (refresh JWT)
        → (offline) → allowed (24h TTL graceful)
        → (revoked mid-session) → blocked (red banner)
```

### Encrypted Storage
- `authState.enc` in `%APPDATA%\93-media-tool-mix-nhac\`
- AES-256-GCM encryption
- PBKDF2 key derivation (300,000 iterations) from machineId
- HMAC-SHA256 integrity check

### Machine Identity
- SHA-256 of hardware identifiers (CPU, Motherboard, Disk, MAC, Windows ID)
- Sent as `x-machine-id` header on every API call
- Mismatch → credentials invalidated → re-auth required

### Activation Key Flow
1. Admin generates key via Dashboard
2. User enters key → `auth:validateKey`
3. Server validates → issues JWT device token + refresh token
4. Key can be revoked/re-issued by admin

### Allow-rebind
Khi user thay đổi phần cứng → machine ID thay đổi → admin gọi `auth:admin/allow-rebind` → user đăng nhập lại với machine ID mới.

---

## 10. Auto-update & Version Gating

### Auto-update
- Library: `electron-updater`
- Channels: `stable` / `beta` (switchable in UI, persisted)
- Check on startup (10s delay) + manual check via Settings
- Events: `updater:status` → checking/available/downloading/downloaded/error

### Version Gating (3-tier)
| Status | Hành vi |
|--------|---------|
| `allow` | App chạy bình thường |
| `block-old` | Hiện VersionBlockingScreen → auto-update flow |
| `block-version` | Hiện VersionBlockingScreen → forced download link |

- Fail-open: timeout 8 giây → cho phép dùng bình thường
- Policy từ server: `GET /api/version-policy` → latest, min supported, blocked versions
- Admin có thể update policy qua Dashboard

---

## Tài liệu liên quan

| Tài liệu | Nội dung |
|-----------|----------|
| [`README.md`](./README.md) | Tổng quan app |
| [`architecture.md`](./architecture.md) | IPC channels, preload API, data flow |
| [`requirements.md`](./requirements.md) | SRS/BRD chi tiết |
| [`security/SECURITY_PLAN.md`](./security/SECURITY_PLAN.md) | Trạng thái bảo mật |
| [`FUNCTIONALITY_TEST_REPORT.md`](./FUNCTIONALITY_TEST_REPORT.md) | Test matrix |
| [`external-tools.md`](./external-tools.md) | FFmpeg/yt-dlp/exiftool usage |
| [`guides/LICENSE_WORKFLOW.md`](./guides/LICENSE_WORKFLOW.md) | License approval flow |
| [`guides/GPU_CPU_ENCODING_PLAN.md`](./guides/GPU_CPU_ENCODING_PLAN.md) | GPU encoding |
| [`guides/ATOMICPARSLEY_SETUP.md`](./guides/ATOMICPARSLEY_SETUP.md) | AtomicParsley setup |
| [`dashboard/DASHBOARD_STATUS.md`](./dashboard/DASHBOARD_STATUS.md) | Admin dashboard status |
