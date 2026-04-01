# 🚀 SUPER PROMPT — 93 Media Tool Mix Nhạc

> Copy toàn bộ nội dung dưới đây vào Claude Code để audit + nâng cấp toàn diện

---

## CONTEXT DỰ ÁN

Đây là Electron 28 + electron-vite + React 18 + TypeScript desktop app cho Windows.
- **Backend**: Node.js (main process), FFmpeg, yt-dlp, Whisper AI
- **Frontend**: React + Zustand + Tailwind
- **Kiến trúc**: IPC invoke/send giữa main ↔ renderer qua preload.ts
- **Build**: `npm run build:win-installer` → NSIS installer
- **Test**: `npm test` (Vitest)
- **CRITICAL**: Không có file `.js` trong `backend/` hay `electron/` — chỉ dùng `.ts` (đã xóa stale JS)

---

## PHASE 1 — AUDIT BUGS 🔍

Hãy làm tuần tự:

### 1.1 — IPC Completeness Check
```
Đọc electron/preload.ts và electron/main.ts + electron/youtube/youtubeHandlers.ts
Liệt kê TẤT CẢ channel ipcRenderer.invoke() trong preload
So sánh với TẤT CẢ ipcMain.handle() trong main
Báo cáo: channel nào trong preload nhưng KHÔNG có handler trong main (→ frontend call sẽ hang)
```

### 1.2 — Type Safety Audit
```
Tìm tất cả: (request as any), (config as any), ts-ignore, @ts-nocheck trong backend/
Báo cáo các cast unsafe có thể gây runtime error
```

### 1.3 — Error Boundary Audit
```
Tìm các async function trong backend/ không có try/catch
Tìm Promise không có .catch() hoặc await không trong try/catch
Đặc biệt: backend/video/finalExport.ts, backend/music/exportAudio.ts
```

### 1.4 — Memory Leak Audit
```
Tìm: EventEmitter không gọi removeAllListeners()
Tìm: setInterval/setTimeout không có clearInterval/clearTimeout
Tìm: Worker/ChildProcess spawn không có kill() on cleanup
```

### 1.5 — Race Condition Audit
```
Tìm shared mutable state không được protect (global variables, singleton stores)
Tìm: concurrent job access trong backend/jobQueue/jobQueue.ts
Tìm: parallel FFmpeg processes writing cùng output file
```

### 1.6 — FFmpeg Argument Bugs
```
Đọc backend/video/finalExport.ts, backend/music/exportAudio.ts, backend/video/mergeVideosSimple.ts
Verify: -y flag TRƯỚC output path (không phải sau)
Verify: pipe drain (stdout/stderr resume) để tránh process hang
Verify: timeout + SIGTERM → SIGKILL pattern
```

---

## PHASE 2 — IMPROVEMENT SUGGESTIONS 💡

### 2.1 — YouTube Downloader Nâng Cấp
Hiện tại dùng yt-dlp với `player_client=tv,android_vr,web_safari`.
Đề xuất cải thiện:
- [ ] Auto-update yt-dlp khi khởi động app (background, silent)
- [ ] Hiển thị warning khi yt-dlp >30 ngày chưa update
- [ ] Support download playlist (không chỉ single video)
- [ ] Queue download (nhiều URL cùng lúc với concurrency limit)
- [ ] Resume interrupted download (`--continue` flag)
- [ ] Download speed display real-time
- [ ] Estimated time remaining

### 2.2 — Export Video Nâng Cấp
Hiện tại: FFmpeg NVENC/CPU encode, subtitle overlay, audio normalization.
Đề xuất:
- [ ] Preview thumbnail trước khi export
- [ ] Batch export với progress tổng thể
- [ ] Export preset save/load (1080p, 4K, mobile, etc.)
- [ ] Hardware detection auto (NVIDIA/AMD/Intel QuickSync)

### 2.3 — Audio Mixer Nâng Cấp
Hiện tại: crossfade, normalize, playlist engine.
Đề xuất:
- [ ] Waveform preview khi chọn bài
- [ ] BPM detection + beat matching crossfade
- [ ] Loudness standard presets (streaming -14 LUFS, YouTube -14 LUFS, broadcast -23 LUFS)
- [ ] Export multiple formats cùng lúc (MP3 320k + FLAC + WAV)

### 2.5 — Autopilot Nâng Cấp
Hiện tại: scheduled daily export với day plans.
Đề xuất:
- [ ] Visual timeline editor cho day plan
- [ ] Preview lịch tuần

---

## PHASE 3 — NEW FEATURES 🆕


### 3.2 — Platform Integration
```
Đề xuất integration với:
- SoundCloud download (yt-dlp đã support)
- Mixcloud download
- Spotify (chỉ metadata/preview, không download)
- TikTok download (yt-dlp support)
```

### 3.3 — Workflow Automation
```
Đề xuất tính năng workflow:
- Import folder → auto scan → auto playlist → auto export trong 1 click
- Preset workflow templates (Daily Mix, Weekly Highlights, Event Set)

### 3.4 — Analytics & History
```
Đề xuất dashboard:
- Lịch sử export (bao nhiêu video, tổng duration, disk used)
- Chart theo ngày/tuần/tháng
- Most used audio files
- Average render time trend
```

---

## PHASE 4 — IMPLEMENTATION PRIORITY 📋

Sau khi audit xong, hãy tạo danh sách ưu tiên:

```
CRITICAL (fix ngay, app có thể crash):
1. ...

HIGH (fix trong sprint này):
1. ...

MEDIUM (improvement cho v4.1):
1. ...

LOW (nice to have cho v5.0):
1. ...
```

---

## OUTPUT FORMAT

Với mỗi bug tìm được, format:
```
🐛 BUG #N — [File:Line] [Severity: P0/P1/P2/P3]
Mô tả: ...
Root cause: ...
Fix: ...
```

Với mỗi improvement:
```
💡 IMPROVEMENT — [Feature Name]
Effort: [Low/Medium/High]
Impact: [Low/Medium/High]
Mô tả: ...
Implementation hint: ...
```

Với mỗi new feature:
```
🆕 NEW FEATURE — [Feature Name]
Priority: [Must/Should/Could]
Effort: [days estimate]
Dependencies: [tools/APIs cần thiết]
Mô tả: ...
```

---

## CONSTRAINTS

- KHÔNG xóa tính năng hiện có
- KHÔNG break backward compatibility với config files
- KHÔNG thêm dependency nặng nếu có lightweight alternative
- KHÔNG thay đổi IPC channel names (breaking change cho stored configs)
- GIỮ NGUYÊN file structure: backend/ electron/ src/
- Mọi fix phải có test case trong tests/unit/fixes/
