# Kiến trúc hệ thống — 93 Media Tool v4.0.2

> Cập nhật lần cuối: 2026-04-02

## Tổng quan

Ứng dụng gồm 4 phần chính:

- **Renderer (React 18)**: UI quản lý nhạc/video/visualizer/autopilot, subscribe progress, hiển thị live stats.
- **Preload (contextBridge)**: expose `window.api` với 16+ modules qua sandbox (`contextIsolation: true`, `sandbox: true`).
- **Main (Electron 36)**: đăng ký IPC handlers, điều phối backend services, spawn công cụ ngoài, auto-update, security monitoring.
- **Server (Cloudflare Workers)**: Auth API, License management, Version policy, Admin Dashboard, Security events, Auto-block engine.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Renderer (React 18 + Zustand + Vite)                              │
│  Keep-alive router: all pages mount once, toggle display:none      │
│  Pages: Auth → Music (4 steps) → Video → YouTube → EnhanceAudio   │
│         → Autopilot → SongNhac → Settings                         │
├──────────────── contextBridge (sandbox: true) ──────────────────────┤
│  Preload: window.api.{license, auth, music, video, youtube,       │
│           songNhac, autopilot, preset, jobQueue, updater, policy,  │
│           security, dialog, system, videoFinalExport, app}         │
├─────────────────────────────────────────────────────────────────────┤
│  Main Process (Electron 36 + Node.js)                              │
│  IPC Handlers → Backend Services → External Tools                  │
│  Background: license refresh (30m), disk monitor (30s),            │
│              security monitoring, auto-updater                     │
├─────────────────────────────────────────────────────────────────────┤
│  Backend Services (TypeScript modules)                             │
│  audio/ auth/ autopilot/ ffmpeg/ jobQueue/ license/ music/         │
│  security/ system/ utils/ video/ youtube/                          │
├─────────────────────────────────────────────────────────────────────┤
│  External Tools (bin/)                                             │
│  ffmpeg · ffprobe · yt-dlp · exiftool · AtomicParsley              │
├─────────────────────────────────────────────────────────────────────┤
│  Cloudflare Workers + D1 + KV                                      │
│  /api/auth/* · /api/security/* · /api/version-policy               │
│  /api/admin/* (dashboard) · /api/video/export (tracking)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Module/Layers

### UI Layer (React 18 + Zustand)

| Module | Mô tả |
|--------|-------|
| **AuthPage** | Login/register, password strength meter, machine ID display |
| **ScanMusicPage** | Quét thư mục nhạc, ffprobe metadata |
| **CreatePlaylistPage** | Tạo/sửa playlist |
| **PreviewPlaylistPage** | Nghe thử playlist |
| **ExportAudioPage** | Xuất audio MP3/WAV với crossfade |
| **EnhanceAudioPage** | 8 audio processing modules với real-time Web Audio preview |
| **CutMergeVideoPage** | Tabs: SingleCut, MultiCut, Merge, Mute, Normalize, Audit |
| **FinalExportTab** | Scan audio+video → encode pipeline |
| **YouTubeDownloaderTab** | yt-dlp single/channel download |
| **SongNhacPage** | Music visualizer: layer editor, engines, timeline, export |
| **AutopilotPage** | Batch DJ set automation (BatchMode + PoolMonitor tabs) |
| **SettingsPage** | App settings |
| **VersionBlockingScreen** | Force-update gate (allow / block-old / block-version) |
| **TopBarStats** | Live CPU%, GPU%, disk R/W, SSD/HDD free, username |

### Service Layer (Backend modules)

| Service | Files | Chức năng |
|---------|-------|-----------|
| **Music** | `scanMusic`, `playlistEngine`, `exportAudio`, `normalizeAudio`, `enhanceAudio/`, `musicPool`, `spotifyMeta` | Quét nhạc, playlist, export, enhance, Spotify metadata |
| **Video** | `cutSingleSimple`, `mergeVideosSimple`, `splitManySimple`, `muteVideoAudio`, `normalizeVideo`, `finalExport`, `videoInfo`, `videoJobManager`, `songNhacFfmpegPipe` | Cắt/ghép/mute/normalize/final export/visualizer pipe |
| **YouTube** | `youtubeDownloader`, `SafeFolderManager`, `browserCookieService`, `tracklistDetector` | Download, cookie support, tracklist detection |
| **Audio** | `whisperTranscribe`, `whisperFasterService`, `subtitleGenerator` | AI subtitle/lyrics (Whisper) |
| **Auth** | `authStore`, `encryptedAuthStore`, `sessionManager`, `passwordValidator` | Encrypted credential storage, session management |
| **License** | `licenseManager`, `machineId`, `onlineLicenseService`, `ticketStore` | Machine-ID binding, online license verification |
| **Autopilot** | `autopilotRunner`, `videoPool` | DJ set batch automation pipeline |
| **Security** | `antiDebug`, `apiSigning`, `environmentDetection`, `licenseCheck`, `rateLimiter`, `securityMonitoring`, `stringEncryption`, `tamperDetection` | Full security stack |
| **System** | `diskInfo`, `realtime`, `sysinfo` | Hardware monitoring |
| **FFmpeg** | `config`, `probe`, `wrapper` | FFmpeg/FFprobe abstraction |
| **Utils** | `cacheCleanup`, `diskSpace`, `gpuDetection`, `pathUtils` | GPU detection (NVENC/AMF), path validation |

---

## Preload API Surface (`window.api`)

### license
| Method | Channel | Mô tả |
|--------|---------|-------|
| `getState()` | `license:getState` | Lấy trạng thái license hiện tại |
| `register(note?)` | `license:register` | Gửi yêu cầu đăng ký license |
| `retry()` | `license:retry` | Force refresh license từ server |
| `clear()` | `license:clear` | Xoá license, reset trạng thái |

### auth
| Method | Channel | Mô tả |
|--------|---------|-------|
| `getState()` | `auth:getState` | Lấy auth state (init từ encrypted store) |
| `register(data)` | `auth:register` | Đăng ký tài khoản mới |
| `login(data)` | `auth:login` | Đăng nhập (có rate limiting) |
| `refresh()` | `auth:refresh` | Refresh session |
| `clear()` | `auth:clear` | Xoá auth state |
| `checkStatus({username})` | `auth:checkStatus` | Kiểm tra trạng thái duyệt |
| `validateKey({username, key})` | `auth:validateKey` | Kích hoạt bằng key |
| `validateToken()` | `auth:validateToken` | Validate JWT token |

### music
| Method | Channel | Mô tả |
|--------|---------|-------|
| `scanFolders(payload)` | `music:scanFolders` | Quét thư mục nhạc |
| `getLastScan()` | `music:getLastScan` | Kết quả scan cuối |
| `createPlaylists(payload)` | `music:createPlaylists` | Tạo playlists |
| `listPlaylists()` | `music:listPlaylists` | Liệt kê playlists |
| `getPoolStats(trackIds)` | `music:getPoolStats` | Thống kê music pool |
| `clearPool()` | `music:clearPool` | Xoá pool |
| `exportPlaylist(req)` | `music:exportPlaylist` | Export playlist → audio |
| `validatePlaylistsForCrossfade(payload)` | `music:validatePlaylistsForCrossfade` | Validate crossfade |
| `normalizeAudio(payload)` | `music:normalizeAudio` | Normalize audio |
| `cancelNormalizeAudio()` | `music:normalizeAudio:cancel` | Cancel normalize |
| `enhanceAudio(req)` | `music:enhance:run` | Chạy enhance pipeline |
| `cancelEnhanceAudio()` | `music:enhance:cancel` | Cancel enhance |
| `renderLoudnormPreview(opts)` | `music:enhance:renderPreview` | Preview loudnorm clip |
| `spotifyMeta(url)` | `music:spotifyMeta` | Lấy Spotify metadata |
| `getExportHistory()` | `music:getExportHistory` | Lịch sử export |
| `deleteExportHistory(ids)` | `music:deleteExportHistory` | Xoá history |
| `downloadPlaylistHistory(...)` | `music:downloadPlaylistHistory` | Download history files |

### preset
| Method | Channel | Mô tả |
|--------|---------|-------|
| `list()` | `preset:list` | Liệt kê export presets |
| `save(name, settings)` | `preset:save` | Lưu preset mới |
| `update(id, name, settings)` | `preset:update` | Update preset |
| `delete(id)` | `preset:delete` | Xoá preset |

### video
| Method | Channel | Mô tả |
|--------|---------|-------|
| `cutSingleSimple(req)` | `video:cutSingleSimple` | Cắt video đoạn đơn |
| `splitManySimple(req)` | `video:splitManySimple` | Cắt batch nhiều video |
| `mergeSimple(req)` | `video:mergeSimple` | Ghép videos (check disk space) |
| `muteAudio(req)` | `video:muteAudio` | Xoá audio khỏi video |
| `normalize(req)` | `video:normalize` | Normalize resolution/FPS |
| `probeFile(path)` | `video:probeFile` | FFprobe thông tin video |
| `getFileInfo(path)` | `video:getFileInfo` | Video info (timeout 8s) |
| `cancelJob(reqId)` | `video:cancelJob` | Cancel job |
| `getAllJobIds()` | `video:getAllJobIds` | List active job IDs |
| `seoApply(payload)` | `video:seo:apply` | Apply SEO metadata |
| `poolMarkUsed(paths)` | `video:pool-mark-used` | Mark video clips used (LRU) |
| `poolPickLRU(folder, count)` | `video:pool-pick-lru` | Pick least-recently-used clips |

### videoFinalExport
| Method | Channel | Mô tả |
|--------|---------|-------|
| `start(payload)` | `video:final-export:request` | Start final export (fire-and-forget) |
| `cancel(requestId)` | `video:final-export:cancel` | Cancel export |
| `scanAudioSource(payload)` | `video:final-export:scan-audio` | Scan audio files |
| `scanVideoSource(payload)` | `video:final-export:scan-video` | Scan video files |
| `onProgress(handler)` | `video:final-export:progress` | Progress listener |
| `onDone(handler)` | `video:final-export:done` | Done listener |
| `onError(handler)` | `video:final-export:error` | Error listener |

### songNhac
| Method | Channel | Mô tả |
|--------|---------|-------|
| `exportVideo(options)` | `song-nhac:export-video` | Start FFmpeg pipe export |
| `getAudioDuration(path)` | `song-nhac:get-audio-duration` | Get duration via ffprobe |
| `readAudioFile(path)` | `song-nhac:read-audio-file` | Read audio buffer |
| `decodeAudioForTimeline(path)` | `song-nhac:decode-audio-timeline` | Audio format info for timeline |
| `listAudioInFolder(folder)` | `song-nhac:list-audio-in-folder` | List audio files |
| `cancelExport(jobId?)` | `song-nhac:cancel-export` | Cancel export |
| `sendExportFrame(data)` | `song-nhac:frame` | Send canvas frame to FFmpeg stdin |
| `sendExportEnd(jobId)` | `song-nhac:end` | Signal end of frame stream |
| `onExportStarted/Progress/Cancel/Config` | listeners | Export event listeners |

### autopilot
| Method | Channel | Mô tả |
|--------|---------|-------|
| `getStatus()` | `autopilot:getStatus` | Trạng thái autopilot |
| `start(config)` | `autopilot:start` | Bắt đầu autopilot pipeline |
| `cancel()` | `autopilot:cancel` | Cancel autopilot |
| `scanVideoFolders(root)` | `autopilot:scan-video-folders` | Đếm video files |
| `getVideoPoolStats()` | `autopilot:video-pool-stats` | Video pool LRU stats |
| `clearVideoPool()` | `autopilot:video-pool-clear` | Xoá pool |
| `onStatus/onLog(handler)` | listeners | Status/log listeners |

### youtube
| Method | Channel | Mô tả |
|--------|---------|-------|
| `verify()` | `youtube:verify` | Kiểm tra yt-dlp binary |
| `validateUrl(url)` | `youtube:validate-url` | Validate YouTube URL |
| `getVideoInfo(url)` | `youtube:get-video-info` | Lấy video metadata |
| `getChannelInfo(url)` | `youtube:get-channel-info` | Lấy channel metadata |
| `getChannelVideos(url)` | `youtube:get-channel-videos` | List channel videos |
| `estimateChannelSize(...)` | `youtube:estimate-channel-size` | Ước tính dung lượng channel |
| `downloadVideo(req)` | `youtube:download-video` | Tải single video |
| `downloadChannel(req)` | `youtube:download-channel` | Tải channel batch |
| `cancelDownload()` | `youtube:cancel-download` | Cancel download |
| `updateYtdlp()` | `youtube:update-ytdlp` | Update yt-dlp binary |

### Các module khác
| API Path | Channels | Mô tả |
|----------|----------|-------|
| `system.info/realtime/getDiskInfo/refreshDiskInfo` | `system:*` | System info, live stats, disk monitor |
| `dialog.openFile/selectFolder/selectVideoFile/...` | `dialog:*` | File/folder pickers |
| `jobQueue.list/get/cancel/onUpdate` | `jobQueue:*` | Job queue management |
| `updater.check/install/getChannel/setChannel/onStatus` | `app:*`, `updater:*` | Auto-update |
| `policy.get()` | `policy:get` | Version policy |
| `security.reportAntiDebug(details)` | `security:reportAntiDebug` | Report debug detection |
| `app.getVersion()` | `app:getVersion` | App version |

---

## Push Events (Main → Renderer)

| Channel | Mô tả |
|---------|-------|
| `version-gate-result` | Version gate status (allow/block-old/block-version) |
| `updater:status` | Auto-updater state (checking/available/downloading/downloaded/error) |
| `system:disk-info` | Disk info broadcast (30s interval) |
| `jobQueue:update` | Job state changes |
| `video:progress` | FFmpeg progress for cut/split/merge/mute/normalize |
| `video:final-export:progress/done/error` | Final export events |
| `music:exportProgress` | Playlist export progress |
| `music:normalizeAudio:progress` | Audio normalize progress |
| `music:enhance:progress` | Audio enhance progress |
| `song-nhac:export-started/progress/cancel/config` | Visualizer export events |
| `autopilot:status/log` | Autopilot progress/log |
| `youtube:progress/batch-progress` | Download progress |
| `youtube:ytdlp-auto-updated` | yt-dlp auto-update result |
| `youtube:ytdlp-age-warning` | yt-dlp binary age warning (>15 days) |

---

## Data Flow Examples

### Scan nhạc → Export audio
1. UI chọn thư mục → IPC `music:scanFolders`
2. Backend filter audio files, spawn ffprobe (concurrent), trả metadata JSON
3. UI tạo playlist → IPC `music:createPlaylists`
4. Export → IPC `music:exportPlaylist` → ffmpeg crossfade → progress events

### Cắt & ghép video
1. UI nhập file/timecode → IPC `video:cutSingleSimple`
2. Backend spawn ffmpeg `-f segment -c copy`, parse stderr `time=` → emit `video:progress`
3. Ghép: concat list, ffmpeg copy-stream hoặc re-encode (GPU/CPU choice)

### Song Nhạc export (Visualizer → Video)
1. UI configure layers + engine + export settings
2. IPC `song-nhac:export-video` → Backend spawn ffmpeg với stdin pipe
3. Renderer render frame-by-frame (deterministic, no RAF) → capture JPEG → IPC `song-nhac:frame`
4. Frames piped to ffmpeg stdin → final video output
5. GPU encode (NVENC/AMF) với CPU fallback nếu GPU fail

### YouTube download
1. UI validate URL → `youtube:validate-url` → `youtube:get-video-info`
2. Download: spawn yt-dlp → parse `[download]` → emit `youtube:progress`
3. Channel batch: iterate video list → concurrent downloads → `youtube:batch-progress`

### Auth & License
1. App start → `auth:getState` → read encrypted store
2. Login → rate limiter check → POST `/api/auth/login` (signed request)
3. Server verify PBKDF2 password + check tamper count → return JWT token
4. License refresh every 30 minutes in background

---

## Bảo mật

### Electron Security
| Measure | Chi tiết |
|---------|----------|
| `sandbox: true` | Chromium sandbox enabled |
| `contextIsolation: true` | Renderer không access Node.js |
| `nodeIntegration: false` | Node.js disabled trong renderer |
| CSP Headers | `self`, `app:`, `blob:`, HTTPS only (production) |
| `setWindowOpenHandler` | Block new windows, chỉ `shell.openExternal` cho HTTPS |
| Path validation | `isValidAbsolutePath`: null byte check, resolve, enforce absolute |
| `rootDir` containment | File delete operations constrained to root directory |
| Dialog whitelist | `dialog:openFile` chỉ cho phép `openFile/multiSelections/openDirectory` |

### Request Security
| Measure | Chi tiết |
|---------|----------|
| Encrypted auth store | AES-256-GCM, PBKDF2 300k iterations |
| Request signing | HMAC-SHA256 (`x-timestamp`, `x-nonce`, `x-signature`, `x-machine-id`) |
| Login rate limiter | Per-username rate limiting |
| String encryption | Server URL decoded from encrypted strings at runtime |
| Anti-debug | DevTools detection, timing anomaly, F12/Ctrl+Shift+I block |
| Tamper detection | Hash check + environment detection (VM/sandbox) |

### Server Security (Cloudflare Workers)
| Measure | Chi tiết |
|---------|----------|
| HMAC verification | PBKDF2 key derivation, timing-safe comparison |
| Nonce dedup | D1 storage with 10-minute expiry |
| Replay prevention | ±5 minute timestamp tolerance |
| Auto-block engine | Rules for nonce reuse, invalid signature, tampering |
| PBKDF2 passwords | 100k iterations server-side, SHA-256, random salt |
| Audit log | Every auth event logged with IP, machineId, severity |
| Zod validation | All request bodies validated |

---

## Background Tasks (Main Process)

| Task | Interval | Mô tả |
|------|----------|-------|
| License refresh | 30 phút | `refreshLicenseState()` → check with server |
| Disk info broadcast | 30 giây | `refreshDiskInfoAndBroadcast()` → emit `system:disk-info` |
| Security monitoring | Startup | `initSecurityMonitoring()` + environment check |
| Tamper detection | Startup | `initTamperDetection()` + `checkTampering()` |
| Auto-updater | Startup | `autoUpdater.checkForUpdates()`, listen update events |
| yt-dlp auto-update | Startup | Update yt-dlp binary if outdated |
| Cache cleanup | Startup | Clean old cache/temp files |
| FFmpeg cleanup | Before quit | SIGTERM all active FFmpeg processes |

---

## Zustand Stores (Frontend State)

| Store | File | Purpose |
|-------|------|---------|
| `useSongNhacLayerStore` | `songNhacLayerStore.ts` | Layer CRUD, selection, clipboard, undo/redo (50-step), groups |
| `useSongNhacAudioStore` | `songNhacAudioStore.ts` | Audio file URL, duration, display name |
| `useSongNhacRuntimeStore` | `songNhacRuntimeStore.ts` | Preview quality, FPS, aspect ratio, zoom, engine config, bloom, bg mode |
| `useSongNhacExportStore` | `songNhacExportStore.ts` | Export progress, dialog state, GPU→CPU retry |
| `useSongNhacTimelineStore` | `songNhacTimelineStore.ts` | Waveform peaks, beat positions, zoom, scroll, playhead |
| `useSongNhacTemplateStore` | `songNhacTemplateStore.ts` | User-saved layer layout presets (localStorage) |

---

## Cấu hình

- Đường dẫn tool: ffmpeg/ffprobe/yt-dlp/exiftool/AtomicParsley (bundle `bin/`), có thể override qua config/env
- Feature flags: `src/config/featureFlags.ts` (hiện chỉ `HIDE_FEATURE_AUTOPILOT`)
- Update channel: `stable` / `beta` (persisted, switchable in UI)
- Thư mục mặc định: music source, video source, output folder
