# Functionality Test Report
*Last updated: 2026-03-28*

## Test Status Overview

| Feature | Module | Status | Notes |
|---------|--------|--------|-------|
| Auth: Register | AuthPage.tsx | ✅ Implemented | 5-state machine: unregistered→pending→allowed |
| Auth: Key validation | AuthPage.tsx + main.ts | ✅ Implemented | Field: key_kich_hoat |
| Auth: Encrypted store | encryptedAuthStore.ts | ✅ Implemented | AES-256-GCM + machine-ID binding |
| Auth: Offline fallback | onlineLicenseService.ts | ✅ Implemented | 24h TTL graceful degradation |
| Song Nhạc: Export Video | songNhacFfmpegPipe.ts | ✅ Fixed | JPEG pipe → FFmpeg mjpeg |
| Song Nhạc: Audio offset | ExportRuntime.ts | ✅ Fixed | startSec + i/fps |
| Song Nhạc: Cancel export | main.ts | ✅ Fixed | ffmpegProc.kill() via Map |
| Song Nhạc: Visualizer engines | runtime/engine/ | ✅ Implemented | Three.js, Butterchurn, AudioMotion, WaveBars, Vanta, WaveJS |
| Song Nhạc: Layer system | store/songNhacLayerStore.ts | ✅ Implemented | image, text, video layers |
| Song Nhạc: Timeline | timeline/TimelineView.tsx | ✅ Implemented | Waveform, beats, zoom |
| Video: Cut single | cutSingleSimple.ts | ✅ Implemented | FFmpeg -ss -t stream copy |
| Video: Split many | splitManySimple.ts | ✅ Implemented | Sequential cuts |
| Video: Merge | mergeVideosSimple.ts | ✅ Implemented | concat demuxer |
| Video: Mute audio | muteVideoAudio.ts | ✅ Implemented | -an flag |
| Video: Final export | finalExport.ts | ✅ Implemented | re-encode with audio mix |
| Video: SEO metadata | seoMetadata.ts | ✅ Implemented | AtomicParsley + ffmpeg |
| YouTube: Download video | youtubeDownloader.ts | ✅ Implemented | yt-dlp wrapper |
| YouTube: Download channel | youtubeDownloader.ts | ✅ Implemented | Concurrent with limit |
| YouTube: Progress tracking | youtubeHandlers.ts | ✅ Implemented | webContents.send |
| Music: Scan folders | scanMusic.ts | ✅ Implemented | Recursive walk |
| Music: Create playlist | playlistEngine.ts | ✅ Implemented | Fisher-Yates shuffle |
| Music: Export audio | exportAudio.ts | ✅ Implemented | MP3/WAV/AAC |
| Music: Normalize audio | normalizeAudio.ts | ⚠️ Partial | Bitrate conversion only, NOT loudness |
| Autopilot: Job lifecycle | autopilotRunner.ts | ✅ Implemented | idle→running→done/error |
| Autopilot: Feature flag | featureFlags.ts | ✅ Implemented | HIDE_FEATURE_AUTOPILOT |
| Auto-update: Check | main.ts | ✅ Fixed | autoUpdater events + 10s startup |
| Auto-update: Channel switch | main.ts | ✅ Fixed | stable/beta + feedURL refresh |
| Security: CSP headers | main.ts | ✅ Implemented | blob: data: in media-src |
| Security: Anti-debug | src/security/antiDebug.ts | ✅ Implemented | DevTools detect + F12 disable |
| Security: Tamper detection | tamperDetection.ts | 🔴 STUB | getExpectedMainHash() always null |
| Security: API signing | apiSigning.ts | ⚠️ NOT WIRED | Module exists, not used in HTTP calls |
| Security: Rate limiter | rateLimiter.ts | ⚠️ NOT WIRED | Module exists, not applied to IPC handlers |

## Known Issues (as of 2026-03-28)
- TamperDetection is a stub — all hash checks return `true`
- apiSigning module defined but not integrated into HTTP requests
- rateLimiter defined but not wrapping auth IPC handlers
- normalizeAudio is actually bitrate conversion, not EBU R128 loudness normalization
- PBKDF2 iterations: 10,000 (should be ≥ 300,000 per NIST 2023)
- Salt in encryptedAuthStore is hardcoded (should be random per-machine)
