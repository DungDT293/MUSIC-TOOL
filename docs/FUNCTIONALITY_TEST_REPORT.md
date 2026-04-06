# Functionality Test Report — 93 Media Tool v4.0.2

*Last updated: 2026-04-02*

---

## Test Status Overview

### Auth & Security

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Auth: Register | AuthPage.tsx | ✅ Implemented | 5-state machine: unregistered→pending→allowed→blocked→error |
| Auth: Login | AuthPage.tsx + main.ts | ✅ Implemented | Rate limiting per-username applied |
| Auth: Key validation | AuthPage.tsx + main.ts | ✅ Implemented | Activation key flow via `/api/auth/validate-key` |
| Auth: Token validation | main.ts | ✅ Implemented | JWT device token + refresh token |
| Auth: Encrypted store | encryptedAuthStore.ts | ✅ Implemented | AES-256-GCM + machine-ID binding |
| Auth: PBKDF2 | encryptedAuthStore.ts | ✅ Fixed | **300,000 iterations** (was 10k, now NIST 2023 compliant) |
| Auth: Offline fallback | onlineLicenseService.ts | ✅ Implemented | 24h TTL graceful degradation |
| Security: Sandbox | windowManager.ts | ✅ Fixed | `sandbox: true` (was false) |
| Security: CSP headers | windowManager.ts | ✅ Implemented | Production: `self`, `app:`, `blob:`, HTTPS only |
| Security: Anti-debug (renderer) | src/security/antiDebug.ts | ✅ Implemented | DevTools size, timing, F12/Ctrl+Shift+I block |
| Security: Anti-debug (main) | backend/security/antiDebug.ts | ✅ Implemented | Report to server |
| Security: API signing | apiSigning.ts + authState.ts | ✅ Fixed | `createSignedHeaders()` **wired into `postJson()`** (was NOT wired) |
| Security: Rate limiter | rateLimiter.ts + authHandlers.ts | ✅ Fixed | `loginRateLimiter.check()` **applied to auth:login** (was NOT applied) |
| Security: Tamper detection | tamperDetection.ts | ⚠️ Partial | `initTamperDetection()` runs on startup; hash checks conditional (return true if no expected hash or dev mode) |
| Security: Environment detection | environmentDetection.ts | ✅ Implemented | VM/sandbox check, reports to server |
| Security: String encryption | stringEncryption.ts | ✅ Implemented | Server URL encrypted at runtime |
| Security: Path validation | authState.ts | ✅ Implemented | `isValidAbsolutePath()` — null byte, resolve, absolute |
| Security: Dialog whitelist | systemHandlers.ts | ✅ Implemented | Only openFile/multiSelections/openDirectory |
| Version gating | App.tsx + main.ts | ✅ Implemented | 3-tier: allow/block-old/block-version, 8s fail-open |

### Song Nhạc (Music Visualizer)

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Export Video | songNhacFfmpegPipe.ts | ✅ Fixed | JPEG pipe → FFmpeg mjpeg stdin |
| Audio offset | ExportRuntime.ts | ✅ Fixed | startSec + i/fps deterministic |
| Cancel export | songNhacHandlers.ts | ✅ Fixed | ffmpegProc.kill() via Map |
| GPU→CPU retry | ExportStore + ExportDialog | ✅ Implemented | Suggest CPU fallback if NVENC fails |
| Visualizer engines | runtime/engine/ | ✅ Implemented | Three.js, Butterchurn, AudioMotion, WaveBars, Vanta, WaveJS (6 engines) |
| Layer system | songNhacLayerStore.ts | ✅ Implemented | image, text, visualizer, video, group layers |
| Layer groups | songNhacLayerStore.ts | ✅ Implemented | Group CRUD, move/reorder children |
| GizmoOverlay | GizmoOverlay.tsx | ✅ Implemented | Drag/resize/rotate, alignment guides, grid snap, multi-select |
| Timeline | TimelineView.tsx | ✅ Implemented | Waveform peaks + beat detection (Web Worker) |
| Undo/Redo | songNhacLayerStore.ts | ✅ Implemented | 50-step history stack |
| Templates | songNhacTemplateStore.ts | ✅ Implemented | Save/load with blob→dataURL conversion |
| Built-in presets | builtInPresets.ts | ✅ Implemented | 10 presets (Neon, Fire, Minimal, etc.) |
| Keyboard shortcuts | useSongNhacKeyboardShortcuts.ts | ✅ Implemented | Delete, Esc, Ctrl+C/V/D/Z/Y |
| Layer filters | layerTypes.ts | ✅ Implemented | 14 CSS-style filters per layer |
| Aspect ratios | RuntimeStore | ✅ Implemented | 9 ratios (16:9 through iPhone) |
| Quality presets | exportConfigTypes.ts | ✅ Implemented | low/medium/full/2K |

### Video Processing

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Cut single | cutSingleSimple.ts | ✅ Implemented | FFmpeg -ss -t stream copy |
| Split many | splitManySimple.ts | ✅ Implemented | Sequential batch cuts |
| Merge | mergeVideosSimple.ts | ✅ Implemented | concat demuxer, disk space check |
| Mute audio | muteVideoAudio.ts | ✅ Implemented | -an flag |
| Normalize video | normalizeVideo.ts | ✅ Implemented | Resolution/FPS normalize |
| Final export | finalExport.ts | ✅ Implemented | Re-encode with audio mix |
| GPU encoding | gpuDetection.ts | ✅ Implemented | NVENC/AMF/VideoToolbox auto-detect |
| SEO metadata | seoMetadata.ts | ✅ Implemented | exiftool + AtomicParsley (iTunes atoms) |
| Video audit | systemHandlers.ts | ✅ Implemented | Batch probe + validate |
| Video pool (LRU) | videoHandlers.ts | ✅ Implemented | Mark used, pick least-recently-used |

### YouTube

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Download video | youtubeDownloader.ts | ✅ Implemented | yt-dlp wrapper |
| Download channel | youtubeDownloader.ts | ✅ Implemented | Concurrent with limit |
| Progress tracking | youtubeHandlers.ts | ✅ Implemented | webContents.send |
| Auto-update yt-dlp | youtubeHandlers.ts | ✅ Implemented | On startup, age warning >15 days |
| Browser cookies | browserCookieService.ts | ✅ Implemented | Age-restricted video support |
| Tracklist detector | tracklistDetector.ts | ✅ Implemented | Auto-detect tracklist in description |

### Music

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Scan folders | scanMusic.ts | ✅ Implemented | Recursive walk, priority/random folders |
| Create playlist | playlistEngine.ts | ✅ Implemented | Fisher-Yates shuffle |
| Export audio | exportAudio.ts | ✅ Implemented | MP3/WAV with crossfade |
| Crossfade validation | musicHandlers.ts | ✅ Implemented | Validate playlists before export |
| Normalize audio | normalizeAudio.ts | ⚠️ Partial | Primary: bitrate conversion. Has `loudnessPreset` option (streaming/youtube/broadcast/club) but default is bitrate-only |
| Enhance audio | enhanceAudio/ | ✅ Implemented | Full pipeline: EQ, Compressor, Limiter, NoiseGate, Stereo, Exciter, NoiseReduction, Loudnorm |
| Spotify metadata | spotifyMeta.ts | ✅ Implemented | Fetch track metadata by URL |
| Export history | musicHandlers.ts | ✅ Implemented | Get/delete/download history |
| Export presets | exportPresets.ts | ✅ Implemented | Save/load/update/delete presets |
| Music pool stats | musicHandlers.ts | ✅ Implemented | Track usage statistics |

### Autopilot

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Job lifecycle | autopilotRunner.ts | ✅ Implemented | idle→running→done/error |
| Feature flag | featureFlags.ts | ✅ Implemented | HIDE_FEATURE_AUTOPILOT (currently visible) |
| Video pool | videoPool.ts | ✅ Implemented | LRU management |
| Batch mode | BatchModeTab.tsx | ✅ Implemented | Tomorrowland/Party Mix/Custom presets |
| Pool monitor | PoolMonitorTab.tsx | ✅ Implemented | Real-time pool stats |

### System & UI

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Auto-update | main.ts | ✅ Fixed | autoUpdater events + 10s startup delay |
| Update channels | main.ts | ✅ Fixed | stable/beta + feedURL refresh |
| TopBar stats | TopBarStats.tsx | ✅ Implemented | CPU%, GPU%, disk R/W, SSD/HDD free, username (1s/30s polls) |
| Keep-alive router | router.tsx | ✅ Implemented | All pages mount once, toggle display:none |
| Collapsible sidebar | Sidebar.tsx | ✅ Implemented | 250px↔72px, persisted localStorage |
| Error boundary | ErrorBoundary.tsx | ✅ Implemented | Catch render errors, reload button |
| Disk space modal | DiskSpaceErrorModal.tsx | ✅ Implemented | Non-dismissible on backdrop |
| Offline banner | App.tsx | ✅ Implemented | Yellow "running offline" banner |
| Account block banner | App.tsx | ✅ Implemented | Red dismissible banner |

### Audio (Whisper/Subtitle)

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Whisper transcribe | whisperTranscribe.ts | ✅ Implemented | @xenova/transformers |
| Faster Whisper (GPU) | whisperFasterService.ts | ✅ Implemented | Python subprocess, CUDA support |
| Subtitle generator | subtitleGenerator.ts | ✅ Implemented | Generate from transcription |

---

## Known Issues (as of 2026-04-02)

### ⚠️ Medium Priority
- **normalizeAudio**: Tên hàm gây hiểu nhầm — primary function là bitrate conversion, NOT loudness normalization. Có `loudnessPreset` option nhưng default là bitrate-only
- **Tamper detection**: Conditional — return true nếu không có expected hash hoặc dev mode. Production build cần inject expected hash
- **INSTALLER_KEY**: Hardcoded trong `stringEncryption.ts` — cần move to env/build-time inject
- **`video_backup/`**: Thư mục chứa code cũ (turbo/RAM/SSD acceleration) — code rác chưa dọn

### 🟢 Low Priority
- **Butterchurn offscreen**: Export có thể bị đen khi Butterchurn engine chạy offscreen (WebGL context issue)
- **`jobQueueService.ts`**: Essentially empty — real queue logic in electron handler layer

---

## Changes Since Last Report (2026-03-28 → 2026-04-02)

| Item | Before (2026-03-28) | After (2026-04-02) |
|------|---------------------|---------------------|
| PBKDF2 iterations | 10,000 ⚠️ | **300,000** ✅ |
| sandbox | `false` ⚠️ | `true` ✅ |
| API signing | NOT wired ⚠️ | **Wired into postJson()** ✅ |
| Rate limiter | NOT applied ⚠️ | **Applied to auth:login** ✅ |
| Tamper detection | STUB (always true) | Partial (conditional on expected hash) |
