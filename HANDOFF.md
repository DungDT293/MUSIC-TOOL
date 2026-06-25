# HANDOFF

Cross-session changelog. **Newest entries on top.** Every feature update or bug fix in this project is logged here so the next session can pick up without re-reading transcripts.

**Format per entry:**
- Date (YYYY-MM-DD)
- What changed (one line)
- Files touched (with line refs when useful)
- Why (the reason, not the steps)

---

## 2026-06-24

### Release prep — bump 4.4.3 cho auto-update
- Files touched:
  - [package.json](package.json), [package-lock.json](package-lock.json) — bump app version lên `4.4.3` để Electron autoUpdater nhận bản mới.
  - [server/env.ts](server/env.ts) — bump `DEFAULT_POLICY_VERSION` lên `4.4.3` để fallback version policy không chặn/sai version khi Worker thiếu row policy.
- Why: user yêu cầu commit/push và chuẩn bị lại auto-update cho bản chứa Tab 6 visualizer + log lỗi rõ hơn.
- Verification: `npm run build` exit 0; `npm run build:win` exit 0 và tạo `dist-electron-output/latest.yml`, `93-media-tool-mix-nhac-setup-4.4.3.exe`, `93-media-tool-mix-nhac-setup-4.4.3.exe.blockmap`, `93-media-tool-mix-nhac-4.4.3-portable.exe`. `npx tsc --noEmit` vẫn fail do lỗi cấu hình TS6305 `.d.ts has not been built from source` hàng loạt (pre-existing/project config), không phải lỗi compile từ electron-vite build. Cần upload artifact lên GitHub Release repo `DungDT293/93-media-tool-releases` để client auto-update thật sự tải được.

### Tab 6 — thêm Line/Mirror/Neon Waveform + log lỗi rõ hơn cho Tab 6/9
- Files touched:
  - [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [electron/handlers/videoHandlers.ts](electron/handlers/videoHandlers.ts), [electron/handlers/videoFinalExportHandlers.ts](electron/handlers/videoFinalExportHandlers.ts) — mở rộng `audioVisualizer.preset` thành `bars-spectrum | line-waveform | mirror-waveform | neon-waveform`, validate runtime payload preview/final-export để tránh IPC drift.
  - [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — thêm dropdown kiểu sóng nhạc trong Tab 6, default `Neon Waveform`, giữ `Bars Spectrum`, đổi text preview thành sóng nhạc chung, lưu/áp preset mới, hiển thị lỗi scan/export/preview kèm chi tiết job/audio/request và gợi ý cách xử lý.
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — dùng FFmpeg `showwaves` cho Line/Mirror/Neon, Neon có glow layer; dùng chung filter cho preview/export; prefix label nội bộ để tránh collision; clear timeout và xóa preview lỗi; log lỗi job gồm code/errno/syscall/path/exitCode/cause; sửa chroma+visualizer không truncate bằng `shortest=0:eof_action=pass`; fail sớm với thông báo rõ nếu bật sóng nhạc trên playlist cần normalize/two-pass.
  - [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx) — log lỗi Autopilot (chức năng 9) giờ kèm bước đang lỗi, chi tiết code/errno/syscall/path/cause và dòng `Cách xử lý` theo nhóm lỗi: disk, permission, missing path, timeout, FFmpeg/media, thiếu audio/video.
- Why: user muốn Tab 6 có cả 3 kiểu sóng mới ngoài Bars và muốn log lỗi của chức năng 6/9 giải thích rõ lỗi ở bước nào, vì sao lỗi, nên sửa gì để chạy lại.
- Behavior preserved: audio duration semantics giữ nguyên; không thêm AI runtime; paths vẫn truyền qua spawn args; visualizer vẫn OFF mặc định ở payload nếu user không bật checkbox.
- Specialist review/fixes: media-export-change + integration QA chạy; đã sửa timeout preview, prefix label Neon, runtime validate audioVisualizer IPC; các case visualizer + input cần two-pass hiện báo lỗi rõ thay vì chạy FFmpeg mơ hồ.
- Verification: `npm run build` exit 0 sau thay đổi visualizer/log; warnings còn lại là warnings cũ dynamic import/font asset/inject-hash sentinel.
- Follow-up: nếu muốn hỗ trợ sóng nhạc trên playlist mixed-resolution/clip ngắn cần implement pipeline 2-stage: concat/normalize trước, sau đó overlay visualizer.

### Tab 6 — thêm Bars Spectrum sóng nhạc khi export video/slideshow + controls/preview
- Files touched:
  - [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) — thêm `FinalExportVisualizerOptions` và payload `audioVisualizer` gồm preset `bars-spectrum`, vị trí, width/height %, margin, màu chính/phụ, opacity, bar count.
  - [shared/ipcSchemas.ts](shared/ipcSchemas.ts) — cho `videoSource` optional để slideshow ảnh-only hợp lệ và validate optional `audioVisualizer` với các field tuỳ chỉnh.
  - [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — thêm checkbox `Hiển thị sóng nhạc Bars Spectrum`, controls vị trí/kích thước/màu/opacity/số cột, nút `Xem thử Bars Spectrum`, preview image, lưu/áp các option trong Export Presets, gửi full `audioVisualizer` trong payload.
  - [electron/handlers/videoHandlers.ts](electron/handlers/videoHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts) — thêm IPC invoke `video:barsSpectrumPreview` / `window.api.barsSpectrumPreview` để tạo preview 1 frame.
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — thêm FFmpeg `filter_complex` tạo bars spectrum từ audio bằng `showfreqs`, apply controls vào overlay thật và preview, force video re-encode + audio AAC khi bật, giữ `-t job.audio.durationSec`, deep-verify khi visualizer active. Nếu bật Bars Spectrum cùng chế độ 2-pass normalize video thì fail rõ ràng thay vì chạy sai.
  - [backend/video/slideshowRenderer.ts](backend/video/slideshowRenderer.ts) — thêm `requestId`/progress/cancel guard, register FFmpeg render ảnh với `videoJobManager`, dùng `windowsHide`.
- Why: user muốn tích hợp sóng nhạc vào chức năng số 6, chọn kiểu Bars Spectrum, sau đó yêu cầu có preview và chỉnh vị trí/kích thước/màu/opacity/số cột.
- Behavior preserved: mặc định OFF nên export cũ không đổi; duration vẫn theo audio; Windows paths vẫn truyền qua `spawn` args, không nhúng path trong filter string.
- Integration QA: kiểm trực tiếp workspace chính thấy `video:barsSpectrumPreview` có handler, preload exposure, `IPCAPI` type và renderer call; `registerVideoHandlers()` đã được đăng ký trong handlers index.
- Verification: `npm run build` exit 0 sau controls/preview. Cần smoke manual trong dev app: audio+video OFF, audio+video ON, preview, audio+ảnh ON, cancel khi đang export.
- Follow-up: Bars Spectrum chưa hỗ trợ đồng thời với `unifyFormat`/2-pass normalize video.

### Tab 6 Bars Spectrum — tăng độ nhạy, default lớn hơn, auto-refresh preview
- Files touched:
  - [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [electron/handlers/videoHandlers.ts](electron/handlers/videoHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts) — thêm field `sensitivity` cho Bars Spectrum payload/preview IPC.
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — apply `volume=<sensitivity>` trước `showfreqs` để phổ nhạc nhảy mạnh hơn theo audio; default backend barCount 128, sensitivity 5x.
  - [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — default visualizer lớn hơn (width 100%, height 30%, margin 24px, opacity 92%, barCount 128), thêm slider `Độ nhạy / Beat boost`, lưu/áp preset, preview tự refresh sau lần bấm xem thử đầu tiên, text nói rõ preview là ảnh tĩnh còn export thật animate theo audio.
- Why: user thấy preview không realtime và sóng quá nhỏ; cần controls rõ hơn và sóng đập mạnh hơn.
- Verification: `npm run build` exit 0.
- Follow-up: nếu muốn realtime preview thật (video/canvas chạy live trong UI), cần làm thêm runtime preview riêng; preview hiện là MP4 10 giây tạo bằng FFmpeg.

### Tab 6 Bars Spectrum — preview 10s MP4 + sửa width không trải đều
- Files touched:
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — `showfreqs` render width nội bộ lớn hơn (`barCount * 16`, cap 3840) để phổ trải đều hơn trước khi scale theo width%; preview đổi từ PNG 1 frame sang MP4 10 giây có audio, H.264/AAC, timeout 60s.
  - [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — bỏ auto-refresh preview gây nhấp nháy; nút preview đổi thành `Xem thử Bars Spectrum 10s`; preview dùng `<video controls autoplay muted loop>` thay vì `<img>`; text hướng dẫn bấm lại sau khi chỉnh.
- Why: user thấy phổ bị tụ ở giữa/không trải đều, preview nhấp nháy liên tục, và muốn xem preview 10 giây thay vì ảnh tĩnh.
- Verification: `npm run build` exit 0.
- Follow-up: kiểm manual trong app xem `app://local-file` stream MP4 preview ổn; nếu Chromium không phát được app-protocol MP4 thì cần expose preview bằng file URL/Blob path riêng.

### Tab 6 Bars Spectrum — default số cột cao để phủ ngang video đẹp hơn
- Files touched:
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — default `barCount` tăng 384, clamp tối đa 1024, internal spectrum width đổi thành `barCount * 12` với min 1920 / max 4096 để phổ không tụ giữa khi width thấp.
  - [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — default UI `Số cột` tăng 384, slider range 64–1024 step 16.
- Why: user thấy phải kéo số cột lên vài trăm thì phổ mới bao hết chiều ngang video; default 128/280 nhìn xấu và không phủ đều.
- Verification: `npm run build` exit 0.

### Fix slideshow ảnh + audio ở Tab 6: chọn nhiều ảnh đúng filter và render FFmpeg không còn `file undefined`
- Files touched:
  - [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — nhánh chọn nguồn ảnh giờ gọi `window.api.selectImageFilesMulti()` thay vì dialog video, clear `videoSource` khi vào slideshow mode.
  - [electron/handlers/systemHandlers.ts](electron/handlers/systemHandlers.ts) — thêm handler `dialog:selectImageFilesMulti` với filter ảnh (`jpg/jpeg/png/gif/bmp/webp/svg`).
  - [electron/preload.ts](electron/preload.ts) — expose `selectImageFilesMulti` cho renderer.
  - [src/types/ipc.ts](src/types/ipc.ts) — thêm type `selectImageFilesMulti: () => Promise<string[] | null>`.
  - [backend/video/slideshowRenderer.ts](backend/video/slideshowRenderer.ts) — sửa lấy FFmpeg path từ `getFfmpegPaths().ffmpeg` thay vì field không tồn tại `ffmpegPath`, tránh lỗi `The "file" argument must be of type string. Received undefined` khi spawn FFmpeg render ảnh.
- Why: user bấm chọn file ảnh nhưng dialog chỉ cho video; sau khi chọn ảnh + audio thì export lỗi vì slideshow renderer truyền `undefined` làm executable path cho `spawn`.
- Verification: `npm run build` exit 0. Cần user retest trong dev app: Tab 6 → chọn nhiều file ảnh + audio + output folder → export.
- Integration QA: agent chạy trong worktree riêng nên báo false-negative từ code cũ; đã verify trực tiếp workspace chính: `dialog:selectImageFilesMulti` có handler/preload/type và renderer `handlePickSource('image','file')` gọi đúng API.

## 2026-06-15

### Plan A — disk-space check chuyển từ CHẶN sang CHỈ CẢNH BÁO + fix đo sai
- Vấn đề user: ổ còn nhiều dung lượng nhưng app chặn xuất video, báo "ổ < 20GB".
- Root cause (2 lớp): (1) `getDiskSpace` fallback về `os.freemem()` (RAM trống) khi WMIC fail — WMIC đã bị gỡ trên Win10/11 mới → báo disk sai. (2) Các điểm check throw/return-false → chặn hẳn.
- Fix lớp 1 — đo đúng: [backend/utils/diskSpace.ts](backend/utils/diskSpace.ts) `getDiskSpace` rewrite dùng `fs.statfs` trước (chính xác, cross-platform, Electron 36/Node 20 luôn có), WMIC chỉ còn là fallback, bỏ hẳn `os.freemem()`. Khi mọi cách fail → trả `{ free: Infinity, unknown: true }` để caller fail-open. Thêm field `unknown?: boolean` vào `DiskSpaceInfo`.
- Fix lớp 2 — không chặn (Plan A, user chọn): chỉ cảnh báo, vẫn cho xuất.
  - [electron/handlers/systemHandlers.ts](electron/handlers/systemHandlers.ts) `confirmResourcesForVideoJob` luôn `return true`, chỉ `console.warn` khi thiếu. Cổng chung cho merge/mute/normalize/music(Tab4)/Tab6-handler.
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) `exportFinalVideo` — `assertMinDiskSpace` bọc try/catch, thiếu thì emit progress cảnh báo `⚠️ ... vẫn đang tiếp tục xuất` thay vì throw.
  - [backend/music/exportAudio.ts](backend/music/exportAudio.ts) — temp-dir check đổi `return success:false` → `console.warn`.
  - [backend/video/mergeVideosSimple.ts](backend/video/mergeVideosSimple.ts) — outputDir check (line ~1168) đổi `throw` → `console.warn`.
- Giữ NGUYÊN chặn ở autopilot (`ensureAudio/VideoDiskSpaceEstimate`): chạy nền nhiều giờ, ổ thật sự đầy thì nên dừng trước — và giờ đo đúng nên không false-positive. Cả 2 hàm đã xử lý `free===Infinity` fail-open.
- KHÔNG đụng yt-dlp downloader disk check (tải về, ngoài scope "xuất video").
- Build: `npm run build` exit 0.

## 2026-06-14

### Harness review (Plan B) — bắt + sửa 4 regression do session media-edit gây ra
- Bối cảnh: các edit media-export trước đó (bỏ subtitle/canvasScene, đổi signature executeFinalExport, rewrite verifyOutputVideo, thêm validatePreTranscodedClips, rewrite getDiskSpace) đã bỏ qua harness → đẻ regression. Chạy `harness-orchestrator` Plan B: 4 specialist review song song (media-ffmpeg, autopilot, integration-qa, youtube). Full report: [_workspace/orchestrator_report.md](_workspace/orchestrator_report.md).
- **BLOCKER đã sửa** [backend/video/outputVerification.ts](backend/video/outputVerification.ts) — `resolutionMismatch` đổi từ `width !== codedWidth || height !== codedHeight` → `codedWidth < width || codedHeight < height`. Bug cũ reject MỌI video 1080p vì H.264 pad 1080→1088 (coded ≥ display là padding bình thường, chỉ coded < display mới là truncate). Vẫn bắt được case thật 1280-header/736-coded.
- **HIGH đã sửa** [backend/video/outputVerification.ts](backend/video/outputVerification.ts) — bỏ `non-monotonous dts` và `premature end` khỏi fatal decode regex. Đó là warning thường gặp của concat-copy demuxer (Pass 2) → fail nhầm video hợp lệ.
- **HIGH đã sửa** [backend/video/finalExport.ts:2339](backend/video/finalExport.ts#L2339) — `validatePreTranscodedClips`: probe-fail giờ non-fatal (giữ duration Pass 1 làm fallback, log warning) thay vì throw cả export chỉ vì 1/3300 clip probe hiccup. Chỉ throw khi resolution/codec/pix_fmt thật sự không đồng nhất.
- **MED đã sửa** [backend/video/finalExport.ts:2339](backend/video/finalExport.ts#L2339) — re-probe đổi từ serial sang batch concurrency 8 (3300 clip serial = 3-8 phút treo giữa Pass 1 và Pass 2). Call site truyền `transcodedDurations` làm fallback.
- **HIGH đã sửa** [src/types/ipc.ts](src/types/ipc.ts) — thêm `chromaKeyPreview` vào IPCAPI (preload + handler đã có nhưng type thiếu → tsc lỗi dưới strict, optional chaining không che được).
- Verified GOOD (2 specialist độc lập): call site `executeFinalExport` ở autopilotRunner.ts:2074 (13 args) + finalExport.ts:3390 (14 args) khớp đúng signature mới — param-shift bug đã sửa. youtube `currentProcess` removal sạch. disk Infinity fail-open an toàn.
- Build: `npm run build` exit 0.
- Deferred (không chặn ship): youtube `dl-${Date.now()}` key collision (pre-existing, low likelihood); dead `FinalExportRequestPayloadSchema` trong ipcSchemas.ts (unused, drifted — align/delete sau).
- Bài học: mọi thay đổi đụng `backend/video|music|ffmpeg` hoặc cross-cutting PHẢI route qua harness-orchestrator/media-export-change TRƯỚC khi sửa — không tự ý edit thẳng.

### Disk-space false-positive fix (diskSpace.ts) — CHƯA review qua harness, cần soi lại
- [backend/utils/diskSpace.ts](backend/utils/diskSpace.ts) — `getDiskSpace` rewrite: dùng `fs.statfs` trước (chính xác, không cần WMIC đã bị gỡ trên Win10/11 mới), bỏ fallback `os.freemem()` (đang trả RAM trống tưởng là disk → cảnh báo "ổ < 20GB" sai dù ổ còn nhiều). Khi mọi cách đo fail → trả `{ free: Infinity, unknown: true }` để caller fail-open (không chặn nhầm).
- Lý do user yêu cầu: ổ còn nhiều dung lượng nhưng app chặn xuất video báo thiếu disk.
- Trạng thái: edit đã có trong working tree, autopilot specialist xác nhận `ensureVideoDiskSpaceEstimate` xử lý Infinity OK (fail-open). Nhưng chưa có review riêng cho ý định "bỏ chặn xuất khi thiếu disk" — user muốn bỏ HẲN chặn, mới chỉ làm phần fix-đo-sai. Cần xác nhận user: giữ cảnh báo (không chặn) hay bỏ luôn cảnh báo.

## 2026-06-14

### Root-cause fix: video output truncate / "Output decode verification failed" trong autopilot
- Symptom (ảnh user): video 2 chỉ 12:34 nhưng audio P02 ~22 phút (truncate ~10 phút); container header ghi 1280x720 nhưng decode thật 736x400 (resolution mismatch tầng container).
- Symptom log: `Output decode verification failed cho video N.mp4` ~410 hits, Job 1 fail tỷ lệ cao nhất, không có ffprobe stderr trong autopilot.log nên không pinpoint được clip nào hỏng.
- Root cause: Pass-2 concat copy build list với `duration X` lấy từ `clip.durationSec` của source (header VBR / GOP rounding / encoder snap → giá trị sai vài giây). FFmpeg đọc directive đó rồi cắt stream sớm → mov atom kết thúc giữa frame → file structurally hỏng → verify decode fail. Đồng thời clip nào có header resolution ≠ stream thật được copy nguyên vào output, decoder fail trên file ghép.
- Files:
  - [backend/ffmpeg/probe.ts:38-40](backend/ffmpeg/probe.ts#L38) — thêm `coded_width`/`coded_height` vào `ProbeResult.video` + show_entries để bắt SPS-level resolution.
  - [backend/video/outputVerification.ts](backend/video/outputVerification.ts) — `verifyOutputVideo` log đầy đủ: file size, format_name, bit_rate, duration vs expected vs diff, resolution `width x height (header)` vs `coded_w x coded_h (coded)` MISMATCH, fps, vCodec/aCodec; luôn dump stderr tail (1KB khi fail, 400 bytes khi pass) thay vì nuốt; mở rộng error pattern bắt thêm `truncated|missing picture|non-monotonous dts|partial file|premature end`. Trả thêm `width/height/codedWidth/codedHeight/resolutionMismatch/fileSizeBytes/bitRate/formatName/decodeStderrTail/decodeExitCode` cho call site dùng làm error message.
  - [backend/video/finalExport.ts:1116-1153](backend/video/finalExport.ts#L1116) — error message khi verify fail giờ chứa diagnostic rõ (resolution mismatch, duration diff cụ thể, decodeExitCode, stderr snippet 200 bytes).
  - [backend/video/finalExport.ts:2339-2425](backend/video/finalExport.ts#L2339) — thêm hàm `validatePreTranscodedClips` re-probe TẤT CẢ file pre-transcoded sau Pass 1, trước khi build concat list cho Pass 2. Trả về `actualDurations` (override metadata cũ) + `mismatchReport` (mô tả nếu phát hiện resolution / codec / pix_fmt heterogeneity).
  - [backend/video/finalExport.ts:2693-2718](backend/video/finalExport.ts#L2693) — hook validation giữa Pass 1 và Pass 2: throw nếu mismatch, log drift nếu duration thật khác metadata > 50ms.
- Why: với 1000-3300 clip mỗi job + concat-copy mode (stream-copy, không re-encode), chỉ 1 clip có header sai là cả output hỏng. Không thể trust source metadata — phải re-probe sau khi pre-transcode để biết file thực có gì. Đồng thời observability cũ (verifier nuốt ffprobe stderr) làm mất khả năng root-cause. Fix observability + fix root cause cùng lúc.
- Loại trừ được trong điều tra (3 sub-agents trên log 44504 dòng): NVENC cold-start (toàn bộ là stream-copy, không có GPU encode), disk/memory pressure (0 hit ENOSPC/EBUSY/OOM), network drive (mọi path local `E:\`), VideoPool drop clip (pool sync sạch).
- Build: `electron-vite build` pass (warnings cũ về dynamic-vs-static imports + font assets, không phải từ patch này).

## 2026-06-13

### Fixed BLOCKER: autopilot reports "sharedTranscodedClipCache is not defined"
- [backend/video/finalExport.ts:730](backend/video/finalExport.ts#L730) — moved `sharedTranscodedClipCache` declaration from inside `try` to before the `try` block so the `finally` cleanup at [:1341](backend/video/finalExport.ts#L1341) can reach it. Was throwing `ReferenceError` after every successful run because `const` declared inside `try {}` is not visible inside the matching `finally {}`.
- Symptom in user log (`%APPDATA%/93-media-tool-mix-nhac/logs/autopilot.log`): all 10/10 videos exported successfully, then the day failed with `sharedTranscodedClipCache is not defined` at the cleanup step. Output `.mp4` files were complete on disk; only the autopilot status was wrong.
- Why: `finally` runs in its own block scope; the `const` declared in the sibling `try` block has gone out of scope by then. Hoisting the declaration to the enclosing function scope fixes lookup without changing the lifecycle (cache is created once per `executeFinalExport` call, cleared in finally).

### Phase B (Quick wins) — dead-code purge after PROJECT_MAP review
- Removed dead code confirmed via grep + 7-subsystem map review. Build passes (`electron-vite build`).
- Files touched:
  - [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts) — deleted `startAutopilotLegacy` (498-line dead duplicate, lines 2662–2932). File 2932 → 2660 lines.
  - [backend/utils/pathUtils.ts](backend/utils/pathUtils.ts) — deleted (was 0-byte file).
  - [src/pages/License/LicenseGate.tsx](src/pages/License/) — deleted (unreachable since auth-V2; whole `License/` folder removed).
  - [src/App.tsx:301-304](src/App.tsx#L301) — removed `#export` offscreen branch + dangling `<ExportRunner />` reference; cleaned unused `useLocation` import.
  - [src/AppLayout.tsx:31-32](src/AppLayout.tsx#L31) — removed `isVisualizerPage` undefined-variable conditional (sót từ song-nhac).
  - [server/auth-v2-handlers.ts](server/auth-v2-handlers.ts) — removed 4 dead `if (false && machineIdChange)` tamper-block branches at lines 488/701/916/1112 (~120 lines). Surrounding active machine-mismatch checks preserved.
  - [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) — dropped `SubtitleOptions` interface + `subtitle` field + `canvasScene` field on `FinalExportRequestPayload`.
  - [shared/ipcSchemas.ts](shared/ipcSchemas.ts) — dropped `subtitle` and `canvasScene` zod entries from `FinalExportRequestSchema`.
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — removed `_subtitle?`/`_options?` placeholder params from `executeFinalExport`; removed corresponding `undefined, undefined` at the call site.
  - [src/pages/Video/FinalExportTab.tsx:610](src/pages/Video/FinalExportTab.tsx#L610) — removed the now-illegal `subtitle: undefined` payload field.
  - [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts) — deleted unreferenced `downloadVideoWithArgsOnce` (~340 lines); deleted legacy `currentProcess` getter/setter + `_legacyCurrentProcess` field; remaining sites in `downloadVideoToFolder` migrated to `addProcess`/`removeProcess` so cancel can actually kill them. File 2486 → 2129 lines.
- Server-side V1 `/api/auth/check` was kept — old released clients (4.1–4.3) may still call it. Removing requires a deprecation window with usage logging; tracked as a future task.
- Why: Phase B of the refactor plan derived from `PROJECT_MAP.md`. User pre-approved every item via Y-all answer. No semantic changes — only pruning of code that was never reached at runtime.

### Pre-refactor project mapping — Phase 2/3 done
- 7 subsystem maps + consolidated `PROJECT_MAP.md` written without overflowing main context (agents read source directly; main only reads the consolidated map).
- Files: [_workspace/PROJECT_MAP.md](_workspace/PROJECT_MAP.md) (~2.5k words, the single read-this-before-refactor doc), plus 7 subsystem files: `_workspace/subsystem_{electron_shell,media_music,media_video,autopilot,youtube,license_auth,react_renderer}.md`.
- Cross-cutting surprises that only emerged on consolidation (not in any single map):
  1. Active-export guard undereports — only `FinalExportTab` registers in `exportActivityStore`, but the same store gates updater install + auth-denial teardown, so audio normalize/merge/mute/multi-cut can be torn down mid-export.
  2. Cancellation has three independent contracts (`videoJobManager` identity-checked, `jobQueue.onCancel`, per-domain singletons + `cancelContext`) with known dead zones in youtube; no single "stop everything" path exists.
  3. `DEFAULT_POLICY_VERSION` ties Worker release process to desktop release — fail-open default + renderer fail-open fallback + updater install gate all converge on the same constant. Bumping `package.json` without bumping `server/env.ts:26` and upserting the D1 row silently downgrades clients.
- Resume rule for refactor planning: fresh session reads `CLAUDE.md` → `HANDOFF.md` → [_workspace/PROJECT_MAP.md](_workspace/PROJECT_MAP.md). Subsystem files are reference detail, not required reading.

### Pre-refactor project mapping — checkpoint before compact
- Phase 1 done: read backbone (CLAUDE/HANDOFF/configs/architecture docs/router/ipc.ts/orchestrator report).
- Phase 2 not yet started: 7 explorer agents per subsystem + 1 consolidator → `_workspace/PROJECT_MAP.md`.
- Plan persisted to [_workspace/PROJECT_UNDERSTANDING_PLAN.md](_workspace/PROJECT_UNDERSTANDING_PLAN.md) — self-contained, includes universal agent prompt scaffold, per-agent scope, consolidator prompt, resume instructions.
- Why now: user is about to compact context. Without this checkpoint, the 7-agent split decision and per-agent scope would be lost and Phase 2 would have to be re-planned.
- Resume rule: a fresh session reads CLAUDE.md → HANDOFF.md → PROJECT_UNDERSTANDING_PLAN.md, then checks which `_workspace/subsystem_*.md` already exist and spawns only the missing ones.

### Project rule established: HANDOFF log
- Every feature update / bug fix gets an entry here.
- Files: `HANDOFF.md` (this file), [CLAUDE.md](CLAUDE.md) (rule reference), auto-memory `feedback_handoff_log_required.md`.
- Why: avoid context loss between sessions; agent picking up work reads this first instead of scrolling chat history.

### Harness extension
- Added orchestrator + integration-qa to route cross-cutting changes.
- Files: [CLAUDE.md](CLAUDE.md), [.claude/agents/integration-qa.md](.claude/agents/integration-qa.md), [.claude/skills/integration-qa/SKILL.md](.claude/skills/integration-qa/SKILL.md), [.claude/skills/harness-orchestrator/SKILL.md](.claude/skills/harness-orchestrator/SKILL.md).
- Why: existing 9 specialists + 7 workflow skills had no router for multi-domain PRs and no QA agent for IPC contract drift.

### Fixed 3 BLOCKERs (from harness orchestrator review)
- [backend/video/finalExport.ts:29](backend/video/finalExport.ts#L29) — removed nested `type` keyword inside `import type { ... }` block (was breaking TS compile).
- [backend/video/finalExport.ts:2367](backend/video/finalExport.ts#L2367) + [2917–2952](backend/video/finalExport.ts#L2917) — chroma branch now uses only fields that exist on `ChromaKeyOverlay` (`bgType`, `keyColor`, `similarity`, `blend`, `position`, `scale`); added `chromaKeyActive` to `needVideoReencode` so `videoCodecArgs` is built via `buildVideoEncoderArgsWithChoice` honoring user's GPU/CPU choice instead of falling back to hardcoded libx264.
- [server/env.ts:26](server/env.ts#L26) — `DEFAULT_POLICY_VERSION` bumped 4.1.0 → 4.4.0 to match `package.json`. Server no longer reports outdated `latest_version` when D1 row missing.
- Why: app on 4.4.0 was about to ship with broken video export (compile fail) and a self-inflicted "behind latest" prompt.

### Fixed 2 HIGHs
- [backend/autopilot/autopilotRunner.ts:626](backend/autopilot/autopilotRunner.ts#L626) — stale-lock recovery no longer gated on `!activeRunToken`; recovery branch now clears the token itself.
- [backend/music/normalizeAudio.ts:273–291](backend/music/normalizeAudio.ts#L273) — refuse normalize when output would overwrite input (same path) **or** when output dir == input dir with a different extension and a same-name file already exists.
- Why: stale lock could pin autopilot at `running` forever after a crash; normalize could silently overwrite unrelated files.

### Outstanding HIGH findings (deferred to upcoming refactor)
- See [_workspace/orchestrator_report.md](_workspace/orchestrator_report.md) for full detail. 9 items remain:
  - Cookie TLS verify off (`rejectUnauthorized: false`)
  - Cookie temp files plaintext + not cleaned up
  - Facebook downloader cancel does not stop in-flight scraper job
  - YouTube retry backoff ignores cancel signal
  - autopilot collision check shuffles → false positives/negatives
  - `startAutopilotLegacy` 498-line dead duplicate
  - `chromaKeyPreview` missing from `IPCAPI` (compiles only via `?.`)
- Why deferred: full refactor planned; #1, #2 explicitly out of scope per user; the rest will be reshaped during refactor.
