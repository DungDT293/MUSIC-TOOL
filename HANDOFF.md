# HANDOFF

## 2026-11-06 — Sóng nhạc: fallback WebGL, dựng Avee bằng canvas 2D, tách filter builder

- Bối cảnh:
  - Engine Three.js của style `avee-circle` chỉ chạy khi có WebGL. Máy không có WebGL (VM, driver cũ) làm constructor ném lỗi ngay trong vòng lặp animation, preview trắng và lỗi lặp lại mỗi frame.
  - Style `avee-circle` không có nhánh trong renderer canvas 2D nên khi fallback lại rơi vào nhánh `pulse-grid` (hình khác hẳn).
  - Mapping filter FFmpeg của Sóng nhạc bị nhúng thẳng trong `songNhacFfmpegPipe.ts`, không test được và dễ lệch khi thêm style.

- Thay đổi:
  1. `src/features/song-nhac/core/renderSongNhacFrame.ts`: thêm nhánh `avee-circle` thuần canvas 2D — đĩa phát sáng theo bass, thanh quang phổ đối xứng hai bên, vòng ngoài xoay, giữ nguyên lớp hạt seed sẵn có.
  2. `src/pages/Music/SongNhacPage.tsx`:
     - Bọc khởi tạo `AveeVisualizerEngine` trong try/catch; đánh dấu `webglUnavailableRef` để không thử lại mỗi frame.
     - Thêm state `webglFallback` để đổi key canvas sang `canvas-2d` (canvas không thể đổi loại context sau khi đã bind WebGL).
     - Vòng render đọc `canvasRef.current` mỗi frame thay vì giữ tham chiếu canvas cũ sau khi remount.
  3. `backend/video/songNhacVisualFilter.ts` (mới): `buildSongNhacVisualFilter()` thuần, clamp width/height, áp trần chiều cao cho từng style.
     - `songNhacFfmpegPipe.ts` dùng lại hàm này, nâng encode lên `-crf 19 -profile:v high`, và sửa type process con (bỏ 3 lỗi TS2322/TS2345/TS18047).
  4. Test: `tests/unit/songNhacVisualFilter.test.ts` (6 case) + thêm case `avee-circle` deterministic vào `tests/unit/songNhacRender.test.ts`.

- Kiểm chứng:
  - `npx vitest run songNhacVisualFilter songNhacRender songNhacAudioBands gpuDetection` -> 22/22 pass.
  - `tsc --noEmit` (cả `tsconfig.json` và `tsconfig.node.json`): không phát sinh lỗi mới ở các file đã sửa.
  - Render thử bằng `bin/ffmpeg.exe` với filter của cả 4 style -> 4/4 ra mp4 hợp lệ.

- Follow-up:
  - Preview Three.js (sóng tròn, logo, hạt) vẫn khác bản export (`showwaves`). Muốn khớp tuyệt đối phải render frame Three.js rồi đẩy sang FFmpeg — việc riêng, chưa làm.
  - `src/features/song-nhac/renderSongNhacFrame.ts` (bản cũ 106 dòng, chữ ký khác) không còn file nào import; có thể xoá sau khi xác nhận.

## 2026-11-06 — Sửa test sóng nhạc lệch hợp đồng mặc định style

- Bối cảnh: tính năng Avee Player (2026-10-29) đổi style mặc định khi cấu hình không hợp lệ từ `neon-tunnel` sang `avee-circle`, nhưng test vẫn khoá giá trị cũ nên suite đỏ.
- Thay đổi: `tests/unit/songNhacAudioBands.test.ts` cập nhật kỳ vọng fallback sang `avee-circle`.
- Kiểm chứng: `npx vitest run tests/unit/songNhacRender.test.ts tests/unit/songNhacAudioBands.test.ts` -> 4/4 pass.

## 2026-11-06 — Nâng chuẩn encode video xuất bản (upload-grade) cho mọi luồng export

- Bối cảnh:
  - Video xuất bằng tool có bitrate thấp hơn hẳn bản xuất bằng phần mềm dựng, nền gradient bị banding sau khi YouTube nén lại.
  - Nguyên nhân gốc: mọi luồng export gọi `buildVideoEncoderArgsWithChoice(..., 'fast')`; tier `fast` dùng NVENC `-preset p1 -cq 23 -b:v 0` (preset nhanh nhất, chất lượng thấp nhất) hoặc libx264 `-preset veryfast -crf 23`, không có VBV ceiling và không set profile.
  - Thêm vào đó pre-transcode 2-pass trong `normalizeVideo.ts` dùng CQ/CRF 23, và Pass 2 concat bằng `-c:v copy`, nên chất lượng bước này chính là chất lượng cuối của file.

- Thay đổi:
  1. `backend/utils/gpuDetection.ts`:
     - Thêm bảng `ENCODE_TUNING` cho 3 tier `fast | medium | slow`: preset NVENC p5/p6/p7, CQ 20/19/17, preset x264 veryfast/medium/slow, CRF 19/18/16, MAXRATE/BUFSIZE 20M/40M, 24M/48M, 30M/60M.
     - Tách 4 helper thuần `buildNvencEncodeArgs`, `buildX264EncodeArgs`, `buildAmfEncodeArgs`, `buildVideoToolboxEncodeArgs`; hai hàm public giữ nguyên chữ ký.
     - Bật lại spatial/temporal AQ cho NVENC (`-spatial-aq 1 -temporal-aq 1 -aq-strength 8`) và thêm `-profile:v high`.
     - Giữ `-vsync 2` để không đổi hành vi timing hiện hữu; `finalExport` vẫn tự chuyển thành `cfr` ở luồng concat.
     - Không dùng `-tune` vì bản legacy FFmpeg đóng gói cho driver cũ không hỗ trợ.
     - VideoToolbox chỉ dùng `-b:v` (bỏ `-maxrate`/`-bufsize`) vì một số build macOS từ chối VBV.
  2. `backend/video/normalizeVideo.ts`: pre-transcode nâng CQ/CRF 23 lên 19 (NVENC p4 -> p5) vì đây là thế hệ nén duy nhất của video cuối.
  3. `backend/video/finalExport.ts`: nhánh fallback `filter_complex` (chroma key / sóng nhạc) nâng `-crf 22` lên 19.
  4. `tests/unit/backend/gpuDetection.test.ts`: thêm 3 test khoá tier NVENC, tham số x264 upload-grade và đường fallback CPU.

- Kiểm chứng:
  - `npx vitest run tests/unit/backend/gpuDetection.test.ts` -> 11/11 pass.
  - `npx vitest run tests/unit/backend/healthCheck.test.ts tests/unit/fixes/bugFixes.test.ts` -> 28/28 pass.
  - `tsc --noEmit -p tsconfig.node.json`: không phát sinh lỗi mới ở `gpuDetection.ts` / `normalizeVideo.ts` (repo còn 39 lỗi type cũ ở file khác, không liên quan).
  - Encode thật bằng `bin/ffmpeg.exe`: nguồn gradient 1080p SSIM Y 0.99924 -> 0.99953, PSNR 57.45 -> 59.74 dB; video thật 1280x704 24fps dung lượng 6.35 MB -> 11.22 MB (bitrate master tăng khoảng 77%).

- Lưu ý / follow-up:
  - Tier `fast` là mặc định cho mọi luồng (finalExport, cutSingle, merge, healthCheck) nên thời gian encode tăng so với trước (NVENC p5 vs p1, x264 CRF 19 vs 23); hiện chưa có option chọn tier trên UI.
  - Máy có driver NVIDIA cũ (API 12.2) vẫn rơi về CPU như cũ.
  - Muốn thêm lựa chọn "chất lượng xuất" cho người dùng phải đi qua `shared/ipcSchemas.ts` + `src/types/ipc.ts` + `FinalExportTab` + autopilot `runtimeOverrides`.

## 2026-10-29 — Nâng cấp tính năng Sóng Nhạc: Tích hợp Three.js Avee Player Style Visualizer

- Bối cảnh:
  - Người dùng phản hồi tính năng Sóng nhạc hiện tại đơn sơ, yêu cầu áp dụng công nghệ mới (đề xuất Three.js) để tạo hiệu ứng sóng nhạc đẹp mắt phong cách Avee Player:
    1. Sóng tròn bao quanh logo đập theo phổ tần số âm thanh (Circular Spectrum Bars).
    2. Logo trung tâm có thể nảy phóng to / thu nhỏ theo beat nhạc (Bass beat pulse / zoom in zoom out).
    3. Camera tự động thở, zoom cận cảnh theo nhịp trống (Beat breathing & subtle camera shake).
    4. Hiệu ứng hạt bụi phát sáng (3D Stardust Particles) bay tỏa theo beat.
    5. Hỗ trợ chọn ảnh logo riêng (PNG/JPG) hoặc sử dụng logo mặc định 93 Media.
    6. Tùy chỉnh màu sắc neon (Cyberpunk, Emerald, Gold, Ocean) và độ nhạy đập beat.
  - Tuân thủ nghiêm ngặt quy tắc UI: Tuyệt đối không thêm icon hay emoji vào giao diện theo `AGENTS.md` và `GEMINI.md`.

- Tính năng & Cải tiến:
  1. **Thư viện Three.js**: Đã cài đặt `three` và `@types/three` phục vụ WebGL GPU acceleration.
  2. **Engine Đồ Họa 3D Three.js (`src/features/song-nhac/three/AveeVisualizerEngine.ts`)**:
     - Thiết lập Scene, PerspectiveCamera và WebGLRenderer hiệu năng cao.
     - Tạo đĩa Logo trung tâm với texture canvas mặc định "93 MEDIA" hoặc texture từ tệp ảnh do người dùng chọn.
     - Vòng viền phát sáng (Inner Ring & Outer Ring) xoay nhẹ và nảy theo nhịp Bass.
     - 96 thanh sóng tròn (Circular Spectrum Bars) ánh xạ theo dải tần âm thanh FFT, đối xứng hai bên.
     - 450 hạt bụi phát sáng (Stardust Particles) bay lơ lửng trong không gian 3D, gia tốc khi có beat mạnh.
     - Camera động học: Tự động zoom in / zoom out theo biên độ Bass và rung lắc nhẹ khi trống dập.
  3. **Cập nhật Giao diện Tab 5 Sóng nhạc (`src/pages/Music/SongNhacPage.tsx`)**:
     - Thêm tùy chọn kiểu "Avee Player (Sóng tròn + Logo beat)" làm kiểu hiển thị chính.
     - Bổ sung bộ điều khiển tùy chỉnh Avee Player:
       + Nút "Chọn ảnh logo" (hỗ trợ chọn ảnh PNG/JPG từ máy) và nút "Mặc định".
       + Lựa chọn tông màu neon: Cyberpunk (Xanh - Hồng), Emerald (Xanh ngọc), Gold (Vàng kim), Ocean (Xanh dương).
       + Thanh trượt "Độ nhạy đập beat" (0.5x đến 2.0x).
       + Hộp kiểm bật/tắt "Hạt bụi sao phát sáng" và "Logo và vòng viền trung tâm".
     - Dùng cơ chế tách key canvas (`key={style === 'avee-circle' ? 'canvas-three' : 'canvas-2d'}`) để chuyển đổi an toàn giữa WebGL và Canvas 2D mà không bị xung đột ngữ cảnh.
  4. **Data contracts & Video Pipe (`shared/songNhacChannels.ts`, `src/features/song-nhac/core/types.ts`, `backend/video/songNhacFfmpegPipe.ts`)**:
     - Bổ sung `'avee-circle'` vào union type `SongNhacStyle`.
     - Cập nhật FFmpeg video pipe hỗ trợ xuất video với style mới.

## 2026-10-14 — Phiên bản v4.5.4: Tính năng Nhạc nền (Background Music), Hòa âm âm lượng & Đóng gói Installer

- Bối cảnh:
  - Người dùng yêu cầu thêm chức năng Nhạc nền (Background Music):
    1. Chức năng 1 (Quét nhạc): Chọn thư mục nhạc nền (`backgroundFolders`) cho từng thể loại.
    2. Chức năng tạo playlist: Thể loại nào có thêm nhạc nền sẽ hiển thị ô chỉnh sửa âm lượng của nhạc nền (mặc định -4 dB) và nhạc ghép (mặc định +2 dB, gồm các bài lấy từ opening, ưu tiên, random). Cả hai thông số cho phép người dùng tùy chỉnh, và có nút "Nghe thử hòa âm" (20 giây) ngay tại giao diện.
    3. Export Audio: Hòa âm nhạc nền chạy ngầm lặp lại suốt playlist với nhạc chính đã ghép qua FFmpeg `amix`.
    4. Autopilot: Đồng bộ cấu hình thư mục nhạc nền và cân bằng âm lượng tương ứng.
  - Tuân thủ quy tắc UI: TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ Ý THÊM ICON HOẶC EMOJI VÀO GIAO DIỆN (UI) theo `AGENTS.md` và `GEMINI.md`.

- Bối cảnh & Chẩn đoán hiển thị:
  - Khi khởi động dev app trên Windows qua Agent CLI, app cần được gọi qua `scripts/launch-dev-desktop.ps1` để gắn đúng vào interactive desktop station (`winsta0\default`). Đã kích hoạt dev app thành công.
  - Về tính năng Nhạc nền: Tại Tab 2 ("Tạo playlist"), nếu thể loại chưa được quét thư mục Nhạc nền ở Tab 1, giao diện trước đó ẩn hoàn toàn khối điều khiển. Đã bổ sung khối thông tin hướng dẫn nét đứt tối giản: "Nhạc nền: Chưa có bài hát (thêm thư mục tại Tab 1 Quét nhạc để kích hoạt hòa âm) · Mặc định hòa âm: Nền -4 dB / Ghép +2 dB" để người dùng luôn thấy rõ tính năng đã sẵn sàng và hiểu cách kích hoạt.
  - **Sửa lỗi trùng folder Nhạc nền & Nhạc ưu tiên/random (`backend/music/scanMusic.ts`, `backend/music/playlistEngine.ts`, `backend/music/scanStore.ts`)**:
    - Khi người dùng chọn cùng một thư mục (ví dụ `open a Tùng`) cho cả Nhạc ưu tiên và Nhạc nền, bộ quét trước đó dùng chung `genreSeenRealPaths` khiến toàn bộ bài nhạc nền bị bỏ qua do trùng lặp (`Duplicate file via symlink, skipping`).
    - Đã tách riêng tập `genreBackgroundSeenRealPaths` cho nhạc nền, giúp các bài trong thư mục nhạc nền được quét độc lập hoàn toàn mà không bị loại trừ bởi nhạc chính.
    - Tạo ID duy nhất cho bài nhạc nền dạng `${genreId}:background:${canonicalPath}` và cập nhật `isCurrentTrackId`.
    - Loại bỏ lọc loại trừ `backgroundPathSet` trong `mainTracks` tại `playlistEngine.ts` để bài hát chính không bị biến mất nếu có mặt trong cả 2 thư mục.
  - **Bổ sung Nhạc nền vào Autopilot Batch Mode (`src/pages/Autopilot/BatchModeTab.tsx`)**:
    - Trước đó Nhạc nền mới chỉ có ở Plan Mode. Đã bổ sung trường `Nhạc nền (tùy chọn)` (`backgroundMusicFolder`) vào từng thẻ thể loại của Batch Mode.
    - Kết nối `backgroundMusicFolder` vào cấu hình lưu trữ, xuất/nhập JSON, khởi chạy `w.api.autopilot.start`, và truyền vào `DayPlanDetailDialog` để mở bộ cân bằng âm lượng (-4 dB / +2 dB) khi xem chi tiết ngày.

- Tính năng & Cải tiến:
  1. IPC & Data Contracts (`src/types/ipc.ts`, `shared/ipcSchemas.ts`):
     - Mở rộng `MusicFolderType` thêm `'background'`.
     - Thêm `backgroundFolders?: string[]` vào `MusicScanGenre`, `ScanMusicFoldersPayload`.
     - Thêm `backgroundTrack?: ScannedTrack`, `bgMusicVolumeDb?: number`, `mainMusicVolumeDb?: number` vào `PlaylistDefinition`.
     - Thêm `backgroundTracks?: ScannedTrack[]`, `selectedBackgroundTrackId?: string`, `bgMusicVolumeDb?: number`, `mainMusicVolumeDb?: number` vào `BuildPlaylistsOptions`.
     - Thêm `backgroundTrackPath?: string`, `bgMusicVolumeDb?: number`, `mainMusicVolumeDb?: number` vào `ExportPlaylistRequest`.
     - Thêm `backgroundMusicFolder?: string` vào `AutopilotFoldersConfig`.
     - Thêm `bgMusicVolumeDb?: number | ''`, `mainMusicVolumeDb?: number | ''` vào `AutopilotDayPlan.overrides`.
     - Thêm IPC API `music.previewMix({ mainTrackPath, bgTrackPath, mainVolumeDb, bgMusicVolumeDb, durationSec })`.
  2. Engine Quét nhạc & Bộ nhớ đệm (`backend/music/scanMusic.ts`, `backend/music/scanStore.ts`):
     - Quét thêm folderType `background`, tính toán `backgroundCount` và `backgroundDuration`.
     - Thêm `backgroundFolders` vào `scanConfigKey` để cache hash tự động làm mới khi đổi thư mục nhạc nền.
  3. Engine Tạo Playlist (`backend/music/playlistEngine.ts`):
     - Tách riêng `backgroundTracks` khỏi `mainTracks` để không bị chọn lẫn vào bài hát chính.
     - Tự động gán `backgroundTrack`, `bgMusicVolumeDb: -4`, `mainMusicVolumeDb: 2` vào từng playlist (hỗ trợ xoay vòng hoặc chỉ định bài cụ thể).
  4. Engine Xuất Audio & Hòa âm (`backend/music/exportAudio.ts`):
     - Khi playlist có `backgroundTrackPath`, render bài chính ra file tạm thời rồi chạy lệnh FFmpeg mix:
       `-stream_loop -1 -i <bgTrack>` cùng bộ lọc `amix=inputs=2:duration=first:dropout_transition=2:normalize=0` với âm lượng tương ứng `volume=<mainVolumeDb>dB` và `volume=<bgMusicVolumeDb>dB`.
  5. Module Nghe thử hòa âm (`backend/music/previewMix.ts`):
     - Trích xuất 20 giây nhạc chính mẫu hòa âm với nhạc nền lặp, xuất trực tiếp sang Data URL Base64 (`data:audio/mp3;base64,...`) an toàn với CSP Electron.
  6. Giao diện Tab 1 ("Quét nhạc" / `ScanMusicPage.tsx`):
     - Bổ sung trường chọn thư mục "Nhạc nền" màu tím nhạt (`#a78bfa`), hiển thị thống kê số lượng bài nhạc nền và tổng thời lượng.
  7. Giao diện Tab 2 ("Tạo playlist" / `CreatePlaylistPage.tsx`):
     - Với mỗi thể loại có thư mục nhạc nền: hiển thị hộp điều khiển "Nhạc nền (X bài)".
     - Slider & input âm lượng nhạc nền (mặc định `-4 dB`, khoảng -30 đến +6 dB).
     - Slider & input âm lượng nhạc ghép (mặc định `+2 dB`, khoảng -12 đến +12 dB).
     - Nút "Nghe thử hòa âm (20s)" tích hợp trình phát audio inline ngay trong thẻ thể loại.
     - Hiển thị thông tin nhạc nền và mức âm lượng trong chi tiết từng playlist đã tạo.
  8. Giao diện Tab 3 ("Xuất nhạc" / `ExportAudioPage.tsx`):
     - Truyền thông tin `backgroundTrackPath`, `bgMusicVolumeDb`, `mainMusicVolumeDb` vào export request.
     - Hiển thị nhãn `Nhạc nền (-4dB / +2dB)` trên từng thẻ playlist.
  9. Autopilot (`backend/autopilot/autopilotRunner.ts`, `src/pages/AutopilotPage.tsx`):
     - Hỗ trợ cấu hình `Thư mục nhạc nền (tùy chọn)`.
     - Cho phép tùy chỉnh âm lượng nhạc nền và nhạc ghép trong hộp thoại cấu hình chi tiết ngày.
     - Tự động quét và hòa âm nhạc nền xuyên suốt các playlist của Autopilot.
  10. Kiểm thử & Đảm bảo chất lượng:
     - `npm run build` hoàn thành 0 lỗi.
     - Toàn bộ 39 test files (263 tests) chạy pass 100%.

## 2026-10-14 — Nâng cấp bảng phát hiện file chưa chuẩn AAC (Xem đường dẫn, tự tạo folder _chuanhoa, xóa file gốc)

- Bối cảnh:
  - Người dùng yêu cầu trong Tab 1 ("1. Quét nhạc" / `ScanMusicPage.tsx`):
    - Phần cảnh báo/phát hiện file chưa phải chuẩn AAC: cần hiển thị chi tiết đường dẫn của các thư mục chứa file chưa chuẩn hóa, tên file và địa chỉ file đầy đủ.
    - Cho phép chọn thư mục xuất ngay tại bảng phát hiện.
    - Đối với các file chưa chuẩn hóa nằm rải rác ở các folder ưu tiên, random hoặc opening: hỗ trợ tự động tạo thư mục đích có thêm đuôi `_chuanhoa` tương ứng cho từng folder nguồn (ví dụ `E:\...\folder_chuanhoa`), tự động xóa các bài chưa được chuẩn hóa sau khi xuất thành công, và cung cấp nút cập nhật cấu hình đường dẫn sang các folder `_chuanhoa` rồi quét lại ngay lập tức.
  - Tuân thủ nghiêm ngặt quy tắc UI: TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ Ý THÊM ICON HOẶC EMOJI VÀO GIAO DIỆN (UI) theo `AGENTS.md` và `GEMINI.md`. Đã gỡ bỏ toàn bộ emoji cũ (`⚠️`).

- Tính năng & Cải tiến:
  1. Backend Audio Normalization (`backend/music/normalizeAudio.ts` & `src/types/ipc.ts`):
     - Mở rộng `NormalizeAudioRequest` với `deleteOriginalOnSuccess?: boolean` và `perSourceFolderSuffix?: string`.
     - Mở rộng `NormalizeAudioResult` với `deletedOriginalFiles?: string[]`.
     - `normalizeSingleFile`:
       - Khi có `perSourceFolderSuffix` (ví dụ `'_chuanhoa'`), tự động tính thư mục đích bằng cách gắn hậu tố vào thư mục nguồn của từng file (ví dụ `E:\...\hardtechno da fix` -> `E:\...\hardtechno da fix_chuanhoa`).
       - Xác minh file đầu ra tạo thành công và có dung lượng hợp lệ (lớn hơn 0 bytes).
       - Khi bật `deleteOriginalOnSuccess: true` và đường dẫn file đích khác file nguồn: tự động xóa file gốc (.wav, .mp3, .flac) một cách an toàn và ghi nhận vào `deletedOriginalFiles`.
  2. Giao diện Tab 1 ("Quét nhạc" / `src/pages/Music/ScanMusicPage.tsx`):
     - Thay thế banner cảnh báo tĩnh cũ bằng một bảng điều khiển tương tác toàn diện:
       - **Thống kê theo từng thư mục nguồn**: Hiển thị nhãn phân loại `[Nhạc ưu tiên]`, `[Nhạc ngẫu nhiên]`, `[Nhạc mở đầu]`, tên thể loại, đường dẫn thư mục nguồn, số lượng bài chưa chuẩn AAC, và đường dẫn thư mục đích tự động (`_chuanhoa`).
       - **Bảng danh sách chi tiết (thu gọn/mở rộng)**:
         - Cho phép xem chi tiết từng file: tên bài hát, phân loại, codec hiện tại (wav, mp3, flac), thời lượng, đường dẫn đầy đủ trên ổ đĩa.
         - Ô tìm kiếm / lọc nhanh theo tên bài hoặc đường dẫn.
         - Nút "Sao chép" đường dẫn file vào clipboard kèm phản hồi "Đã chép".
       - **Cấu hình thư mục xuất linh hoạt**:
         - Lựa chọn 1 (Khuyên dùng): Tự động tạo folder riêng có đuôi `_chuanhoa` tương ứng cho từng thư mục nguồn.
         - Lựa chọn 2: Xuất toàn bộ file vào một thư mục được chỉ định (có nút chọn thư mục qua dialog hệ thống).
         - Lựa chọn 3: Lưu cùng thư mục với file gốc.
       - **Tùy chọn xử lý an toàn**:
         - Checkbox `Tự động xóa các bài chưa được chuẩn hóa sau khi xuất thành công` (mặc định bật theo yêu cầu người dùng).
         - Lựa chọn Bitrate: 384 kbps (Chuẩn YouTube chất lượng cao), 320 kbps, 256 kbps, 192 kbps.
       - **Tiến trình trực tiếp**: Hiển thị thanh tiến trình %, số lượng file đang xử lý, tên file hiện tại, thời gian ước tính còn lại (ETA) và nút "Dừng chuẩn hóa".
       - **Kết quả & Cập nhật tự động**:
         - Hiển thị tổng kết số file chuyển đổi thành công và số file gốc đã xóa an toàn.
         - Nút bấm 1 chạm: `Cập nhật cấu hình thư mục sang các folder _chuanhoa và quét lại ngay` giúp tự động thay thế đường dẫn trong các thể loại sang các folder `_chuanhoa`, lưu cấu hình và tự động quét lại thư viện.
  3. Kiểm thử & Đảm bảo chất lượng:
     - Tạo mới `tests/unit/backend/normalizeAudio.test.ts` kiểm thử:
       - Tự động tạo thư mục với `perSourceFolderSuffix` và xóa file gốc khi `deleteOriginalOnSuccess: true`.
       - Giữ nguyên file gốc khi `deleteOriginalOnSuccess: false`.
     - Toàn bộ 39 test files (263 tests) chạy pass 100%.
     - `npm run build` hoàn thành thành công 0 lỗi.

- Bối cảnh:
  - Người dùng yêu cầu: Tab "Playlist theo thể loại" (`CreatePlaylistPage.tsx`) trước đây mới chỉ có phần ghim nhạc ưu tiên và random ("Nhạc ghim đứng đầu playlist"), chưa có phần tìm kiếm và ghim nhạc từ thư mục mở đầu (opening). Cần bổ sung tính năng ghim nhạc folder opening cho từng thể loại và cấu hình tạo playlist.
  - Tuân thủ nghiêm ngặt quy tắc UI: TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ Ý THÊM ICON HOẶC EMOJI VÀO GIAO DIỆN (UI) theo `AGENTS.md` và `GEMINI.md`.

- Tính năng & Cải tiến:
  1. Hỗ trợ ghim nhạc mở đầu ở Backend & Engine (`backend/music/playlistEngine.ts`, `src/types/ipc.ts`):
     - Thêm `pinnedOpeningTrackIds?: string[]` và `combineAllPinnedOpenings?: boolean` vào `BuildPlaylistsOptions`.
     - `buildSinglePlaylist`: Nâng cấp tham số `openingTrack` hỗ trợ cả `ScannedTrack` đơn lẻ hoặc mảng `ScannedTrack[]` khi ghép nhiều bài intro mở đầu.
     - `buildPlaylists`:
       - Khi người dùng ghim các bài mở đầu cụ thể (`pinnedOpeningTrackIds`), engine sẽ lọc `effectiveOpeningPool` chỉ chứa các bài mở đầu được ghim.
       - Nếu không ghim bài nào: engine tự động xoay vòng toàn bộ bài trong thư mục opening như mặc định (100% backward compatible).
       - Hỗ trợ cờ `combineAllPinnedOpenings`: Nếu bật, mỗi playlist sẽ ghép toàn bộ bài mở đầu đã ghim vào đầu playlist; nếu tắt (mặc định), engine xoay vòng 1 bài/playlist giữa các bài đã ghim.
  2. Giao diện Tab "Playlist theo thể loại" (`src/pages/Music/CreatePlaylistPage.tsx`):
     - Thêm khối `<details>` mới: **Ghim nhạc mở đầu (folder opening)** trên từng thẻ thể loại, ngay trước phần "Nhạc ghim đứng đầu playlist".
     - Có ô tìm kiếm bài mở đầu riêng biệt cho từng thể loại (`Tìm tên bài mở đầu để ghim...`).
     - Có các nút tiện ích: `Ghim tất cả`, `Bỏ ghim tất cả`, và checkbox `Ghép tất cả bài mở đầu đã ghim vào đầu mỗi playlist`.
     - Danh sách bài hát mở đầu hiển thị checkbox Ghim, tên file, thời lượng, và nhãn thống kê số bài đã ghim / tổng kho.
     - Khắc phục tình trạng xung đột ô tìm kiếm: tách riêng `genreOpeningSearch`, `genrePinnedSearch`, và `genreEndingSearch` theo từng thể loại thay vì dùng chung 1 state toàn cục.
     - Trong bảng kết quả playlist sau khi tạo: các bài mở đầu được ghim sẽ hiển thị rõ loại bài là `Nhạc mở đầu (Ghim)`.
     - Cập nhật mục "Hướng dẫn nhanh" giải thích rõ cách hoạt động của tính năng ghim nhạc mở đầu.
  3. Kiểm thử & Đảm bảo chất lượng:
     - Thêm 3 unit test mới vào `tests/unit/backend/playlistEngineOpening.test.ts`:
       - Test chỉ dùng bài mở đầu được ghim (`uses only pinned opening tracks when pinnedOpeningTrackIds is provided`).
       - Test xoay vòng giữa các bài mở đầu đã ghim (`rotates exclusively among pinned opening tracks when multiple are pinned`).
       - Test ghép tất cả bài mở đầu đã ghim khi bật cờ combine (`prepends all pinned opening tracks when combineAllPinnedOpenings is true`).
     - Toàn bộ 38 test files (261 tests) chạy pass 100%.
     - `npm run build` biên dịch thành công 0 lỗi.

## 2026-10-13 — Physical 1-Hour (3600s) Video Render Test from User's Raw Materials

- Context: User asked to create a real 1-hour (3600s) video using raw materials from their two production folders (`E:\nguyen lieu nhac\hardtechno da fix` and `E:\nguyen lieu nhac\video veo 3`).
- Execution & Script: `scripts/render_1hour_user_production.ts`
  1. Audio Master Generation:
     - Scanned 51 WAV files in `E:\nguyen lieu nhac\hardtechno da fix`.
     - Selected 48 tracks to reach target duration.
     - Properly escaped single quotes in file paths (handling filenames with quotes such as `019_DLV - Der Teufel (Gazometer '98 Mix)...`).
     - Rendered master audio: `E:\nguyen lieu nhac\xuat_video_1_tieng\hardtechno_master_audio_1hour.m4a` (169.03 MB, AAC 384k 48kHz, exactly 3600.00s = 60.0 minutes) in 143.8 seconds.
  2. Final Video Planning & Execution:
     - Scanned full pool of 6,612 video clips in `E:\nguyen lieu nhac\video veo 3`.
     - Planner selected 716 clips (398 base clips + 120 reserve recovery clips) with Fisher-Yates random shuffle to match 3600s audio.
     - Executed `planFinalExport` and `executeFinalExport` using ultra-fast copy-stream muxing.
     - Render completed in 114.3 seconds (~1.9 minutes for 1-hour video).
  3. Output Verification:
     - Video Path: `E:\nguyen lieu nhac\xuat_video_1_tieng\Hardtechno_Veo3_Mix_1Hour_Final.mp4`
     - File Size: `2608.28 MB` (~2.6 GB)
     - Resolution: `1280x704`, 24 fps, Codec: `h264`
     - Audio Codec: `aac`, stereo
     - Duration: `3600.13s` (exactly 60.00 minutes, 0.13s delta)
     - Output verification: `verifyOutputVideo` passed 100% (video stream active, audio stream active, playback test OK).
- Files: [scripts/render_1hour_user_production.ts](scripts/render_1hour_user_production.ts), [HANDOFF.md](HANDOFF.md).

## 2026-10-13 — Auto-Delete Corrupt Media on Completion & Complete File Audit Upgrade (Audio + Video)

- Context:
  - User requested:
    1. Automatic deletion of corrupt/unreadable files upon job completion (Final Export, Merge Videos, Autopilot) so subsequent runs never hit them again, without impacting export performance.
    2. Complete upgrade of the "Rà soát file" (File Audit) tab to recursively scan both audio and video files across all subdirectories, diagnose corrupted files with explicit reasons, and provide 1-click batch deletion.
  - Strict UI Rule: TUYỆT ĐỐI KHÔNG TỰ Ý THÊM ICON HOẶC EMOJI VÀO GIAO DIỆN (UI) per `AGENTS.md` and `GEMINI.md`.

- Enhancements:
  1. Auto-Clean Architecture on Completion:
     - `backend/video/finalExport.ts`:
       - `loadVideoClips` now returns `{ clips, invalidDetails }`.
       - `scanVideoSourceForPlan` propagates both valid clips and `invalidDetails`.
       - `planFinalExport` collects `invalidVideoFiles` alongside `audioFailures`.
       - `executeFinalExport` automatically deletes all collected corrupt audio/video files and any quarantined files (`fsp.unlink`) upon job completion (`[FinalExport][AutoClean]`). Runs asynchronously right after export completes, keeping render performance 100% unaffected.
     - `backend/video/mergeVideosSimple.ts`:
       - Automatically unlinks any corrupted video files detected during `validateInputFiles` upon completion (`[mergeVideosSimple][AutoClean]`).
     - `backend/autopilot/autopilotRunner.ts`:
       - Inherits the auto-cleanup mechanism through `runExportVideoWithOptions` -> `finalExport`.
  2. Full Audit Engine Upgrade (`electron/handlers/systemHandlers.ts`):
     - Added `media:listMediaFilesInFolder` IPC handler to recursively discover files by mode (`all`, `video`, `audio`).
     - Upgraded `video:auditFolder` to probe both video and audio files, with an O(1) concurrent worker pool (16 workers) to handle thousands of clips smoothly.
     - Fixed Windows case-insensitive path prefix validation in `video:deleteFiles`.
  3. "Rà soát file" Tab UI Overhaul (`src/pages/Video/AuditFilesTab.tsx`):
     - Added scan mode switcher: `Tất cả (Video và Nhạc)`, `Chỉ Video`, `Chỉ Nhạc (Audio)`.
     - Displays comprehensive statistics (valid videos, valid audios, corrupt count, detailed file paths and specific error causes).
     - Added 1-click "Xóa tất cả file lỗi" button with a confirmation modal showing items to be purged.
     - 100% compliant with zero-icon / zero-emoji rule (clean, professional Vietnamese text UI).

- Live Verification on User's Library:
  - User Folders: `E:\nguyen lieu nhac\video veo 3` (6,612 valid video clips) and `E:\nguyen lieu nhac\hardtechno da fix` (51 valid WAV tracks).
  - Test Media Injected: 100 corrupted video files (`__corrupt_test_vid_001.mp4` .. `100.mp4`) and 5 corrupted audio files (`__corrupt_test_song_01.wav` .. `05.wav`).
  - Execution Result (`scripts/test_user_corrupted_folders.ts`):
    - Video: 6,712 clips scanned -> 6,612 valid clips preserved, 100/100 corrupted clips detected and skipped.
    - Audio: 56 files scanned -> 51 valid tracks preserved, 5/5 corrupted tracks rejected with recovery hints.
    - Export: Successfully rendered `001_@MilleniumKid...mp4` (13.79 MB, 1280x704, h264/aac) in 2.1 seconds.
    - Auto-Clean on Completion: 100/100 corrupted video files and 5/5 corrupted audio files were automatically unlinked from disk upon export completion.
    - Disk Verification: 0 corrupted video files remaining, 0 corrupted audio files remaining on disk!
  - Tests: `npm run build` cleanly passed, 22/22 Vitest test files (144/144 tests) passed.

- Files Modified:
  - `backend/video/finalExport.ts`
  - `backend/video/mergeVideosSimple.ts`
  - `electron/handlers/systemHandlers.ts`
  - `electron/preload.ts`
  - `src/types/ipc.ts`
  - `src/pages/Video/AuditFilesTab.tsx`
  - `HANDOFF.md`

## 2026-10-13 — Corrupted Media Stress Test on User's Library (100 Corrupt Videos + 5 Corrupt Audios) & Recursive Scan

- Context: User provided real local folders (`E:\nguyen lieu nhac\video veo 3` and `E:\nguyen lieu nhac\hardtechno da fix`) and asked to inject 100 corrupted video files (5s fake) and several corrupted audio files to test how the tool reacts and handles real-life corrupted media.
- Enhancements:
  1. Recursive folder scanning for Video & Audio sources (`backend/video/finalExport.ts`, `electron/handlers/systemHandlers.ts`):
     - `loadVideoClips` and `loadAudioFiles` now recursively traverse subdirectories when `source.type === 'folder'`.
     - `listVideoHandler` in IPC (`video:listVideosInFolderSimple`) now traverses subdirectories.
     - Automatically discovered all 6,612 video clips organized across subfolders (`video veo 3/hugel` and `video veo 3/tomorrow`).
- Execution & Results (`scripts/test_user_corrupted_folders.ts`):
  1. Generated in `E:\nguyen lieu nhac\video veo 3`:
     - 100 corrupted video files (`__corrupt_test_vid_001.mp4` .. `100.mp4`): 30 empty 0-byte, 30 random bytes, 20 broken MP4 headers (missing moov atom), 20 non-media text files.
  2. Generated in `E:\nguyen lieu nhac\hardtechno da fix`:
     - 5 corrupted audio files (`__corrupt_test_song_01.wav` .. `05.wav`): 2 empty 0-byte, 2 random bytes, 1 corrupted header.
  3. Scan & Plan Verification:
     - Audio: 56 files scanned -> 51 valid tracks accepted, 5 corrupted tracks automatically rejected with detailed repair hints without stopping.
     - Video: 6,712 files scanned -> 100 corrupted files detected and skipped with warnings (`Video không có duration hợp lệ`), 6,612 valid video clips preserved (11.10 hours total).
  4. Physical Export Verification:
     - Rendered real job using user's track `001_@MilleniumKid & JBS...` and clips from `video veo 3`.
     - Output: `E:\TOOL DUNG CODE\93-media-tool-mix-nhac\test_real_scale\output_user_test\001_@MilleniumKid & JBS - Vielleicht Vielleicht (Holy Priest & elMefti Remix) (Music Video)_x8.mp4` (14.60 MB, 1280x720, h264/aac, 21.33s).
     - Result: 100% success, zero crashes, all corrupted media safely skipped and reported.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [electron/handlers/systemHandlers.ts](electron/handlers/systemHandlers.ts), [scripts/test_user_corrupted_folders.ts](scripts/test_user_corrupted_folders.ts), [HANDOFF.md](HANDOFF.md).

## 2026-10-13 — Full-Scale Real Media Test: 18 Audio Tracks + 2000 Video Clips (5s) -> 1-Hour (3600s) Target Exports

- Context: User asked to test with real-life production scale: 15-20 audio tracks, 2000 small video clips (5s each), target duration setting 1 hour (3600s), physically rendered on disk and verified with FFprobe.
- Implementation: Created `scripts/test_real_scale_1hour.ts` and executed physical render pipeline on disk (`E:\TOOL DUNG CODE\93-media-tool-mix-nhac\test_real_scale\`):
  1. Real Audio Sources:
     - 18 real audio tracks (`song_01.m4a` .. `song_18.m4a`, 200s each, AAC 128k, total = 3600s = 1 hour).
     - 2 corrupt audio files (`corrupt_audio_empty.m4a` [0 byte] & `corrupt_audio_garbage.m4a` [30 KB random noise]).
  2. Real Video Sources:
     - 2000 real video clips (`clip_0001.mp4` .. `clip_2000.mp4`, 5s each, 640x360 30fps H.264, total pool = 10,000s = 2.77 hours).
     - 5 corrupt video files (`corrupt_video_01.mp4` .. `05.mp4`, 0 byte & random garbage).
  3. Physical Execution Results:
     - Part A (Music Mixing / Tab 4): Merged 18 songs into 1-hour master mix audio:
       - File: `E:\TOOL DUNG CODE\93-media-tool-mix-nhac\test_real_scale\output\mixed_audio_1hour.m4a` (55.65 MB, duration 3600.0s).
     - Part B (Video Merging / Tab 5): Scanned 2005 files. Skipped all 5 corrupt files with ffprobe diagnostics. Shuffled and merged clips from pool of 2000 to fill exactly 1 hour:
       - File: `E:\TOOL DUNG CODE\93-media-tool-mix-nhac\test_real_scale\output\merged_video_1hour.mp4` (3.92 MB, duration 3600.0s, resolution 640x360 H.264).
     - Part C (Final Export / Tab 6): Muxed 1-hour audio mix with 866 clips shuffled from pool of 2000 clips with copy-stream in 2.4 seconds:
       - File: `E:\TOOL DUNG CODE\93-media-tool-mix-nhac\test_real_scale\output\Final_Video_Mix_1Hour.mp4` (61.47 MB, duration 3600.10s, resolution 640x360 H.264, audio AAC).
     - Verified with `ffprobe`: both audio and video streams active, synchronized, matching 1 hour (3600s).
- Files: [scripts/test_real_scale_1hour.ts](scripts/test_real_scale_1hour.ts), [HANDOFF.md](HANDOFF.md).

## 2026-10-13 — Real Media Pipeline Verification (FFmpeg Physical Files & Corrupted Media Recovery)

- Problem statement: User requested real end-to-end execution on physical disk (not mocked unit test / code speculation) with real media files (video/audio generated via real FFmpeg binaries) mixed with corrupted files (0-byte empty file, random byte junk data) to verify:
  1. The system correctly detects and skips corrupted media files.
  2. The system warns/logs details of corrupted files without crashing the job.
  3. The system compensates with healthy files to reach user-specified target duration.
  4. Physical output files are inspected with real ffprobe for stream integrity, resolution, duration, and codec.
- Changes & Fixes:
  1. Output filename extension safety (`backend/video/mergeVideosSimple.ts`):
     - Identified bug in `generateOutputFileName`: when `total === 1` and `baseFileName` had no extension, it returned raw `baseFileName`, causing FFmpeg to error out with "Unable to choose an output format".
     - Fixed `generateOutputFileName` to enforce `${nameWithoutExt}${ext}`, ensuring `.mp4` is always present regardless of `mergeCount` or user input formatting.
  2. End-to-end real media integration test (`tests/unit/backend/realCorruptedPipeline.test.ts`):
     - Uses real bundled `bin/ffmpeg.exe` and `bin/ffprobe.exe` to generate genuine media files:
       - 3 valid video files (`lavfi color=c=red/blue/green:s=640x360:d=5:r=30`, libx264, yuv420p).
       - 2 corrupt video files (1 0-byte file, 1 50KB random bytes).
       - 2 valid audio files (`lavfi sine=frequency=440/880:duration=10/12`, aac, 128k).
       - 2 corrupt audio files (1 0-byte file, 1 30KB random bytes).
     - Test Case 1: `mergeVideosSimple`
       - Input: 5 video files (3 valid 5s clips = 15s total, 2 corrupt).
       - Target duration: 22s (exceeds 15s total, requires looping valid clips).
       - Verified: Tool detected both corrupt clips, emitted warning `Đã bỏ qua 2 video lỗi / hỏng trước khi ghép`, loop-compensated with valid clips to generate `real_merged_test.mp4`.
       - ffprobe verification: width=640, height=360, vCodec=h264, duration >= 21.5s, file size > 10KB. Test passed!
     - Test Case 2: `planFinalExport` + `executeFinalExport`
       - Input: 4 audio files (2 valid 10s & 12s, 2 corrupt) + 5 video files (3 valid, 2 corrupt).
       - Verified: `scanAudioSourceForPlan` rejected both corrupted audio files with actionable repair hints. `planFinalExport` planned exactly 2 jobs (matching the 2 valid audio files).
       - `loadVideoClips` rejected both corrupted video files with warnings and preserved all 3 valid clips.
       - Execution: Both jobs completed successfully (Job 1: 10s audio -> 10.09s MP4; Job 2: 12s audio -> 12.09s MP4).
       - ffprobe verification: both output files contain active video (640x360, h264, 30fps) and audio (aac) streams with duration matching expected audio duration.
- Files: [backend/video/mergeVideosSimple.ts](backend/video/mergeVideosSimple.ts), [tests/unit/backend/realCorruptedPipeline.test.ts](tests/unit/backend/realCorruptedPipeline.test.ts), [HANDOFF.md](HANDOFF.md).
- Verification: 144/144 tests passed across 22 test suites in vitest, `npm run build` compiled 100% cleanly.

## 2026-10-13 — Audit and overhaul video shuffling & duplicate prevention across renders (Merge & Final Export & Autopilot)

- Changed:
  1. Video playlist planner overhaul (`backend/video/utils/videoPlaylistPlan.ts`):
     - Identified critical root cause: `buildSequence` previously performed a simplistic linear scan (`cursor = (cursor + 1) % len`). Jobs in a batch were 90%+ identical (only shifted by 1 clip), and consecutive render runs only differed by minor linear shifts, resulting in nearly identical merged video sequences across renders. Once linear shifts reached `clips.length`, it prematurely threw `VideoSequenceExhaustionError`.
     - Replaced `buildSequence` with a high-entropy Mulberry32 pseudo-random Fisher-Yates permutation sequence generator.
     - Each `(jobIndex, attempt)` pair generates a diverse, independent permutation.
     - When `duration < target` requires looping, pool is reshuffled on every loop pass and adjacent duplicate clips at loop boundaries are automatically swapped, eliminating repetitive linear loops.
     - Preserved single-clip exhaustion contract (when pool contains only 1 clip, it gracefully satisfies bounded repetition and exhaustion tests).
     - Added optional `seed` parameter to `planVideoBatch` allowing callers to inject high-entropy crypto seeds per render run.
  2. Shuffle helpers & PRNG fixes (`backend/video/utils/videoShuffleHelpers.ts`):
     - Replaced flawed Xorshift32 (which was trapped at state 0) with Mulberry32 PRNG (full 2^32 period, non-zero init).
     - Fixed `shuffleOnce`: Removed arbitrary discard threshold (`r < 0.0001 || r > 0.9999`) to restore uniform Fisher-Yates distribution.
     - Fixed `generateUniqueSeed`: Cryptographically combines `baseSeed`, `randomBytes(4)`, and job index.
     - Improved `buildRandomPermutations`: Safely handles small clip pools (e.g. 1-2 clips) without throwing unhandled exceptions when `repeatCount` exceeds mathematical permutations.
     - Improved `buildPlaylistToFillDuration`: Loop reshuffles use evolving unique seeds per pass; boundary repeats are avoided.
  3. Final Export per-job seed entropy, bad-clip skip & UI controls (`backend/video/finalExport.ts`, `src/pages/Video/FinalExportTab.tsx`):
     - In `finalExport.ts`: All fallback and direct `buildPlaylistToFillDuration` calls now receive unique crypto seeds per job (`Date.now() + job.jobIndex * 2000000 + randomBytes(4).readUInt32BE(0)`), preventing clone sequences between jobs.
     - In `loadVideoClips`: When a folder contains a few corrupted/unreadable clips alongside valid clips, `loadVideoClips` now logs detailed warnings and automatically skips the bad clips instead of throwing a fatal error and blocking the entire export. The remaining valid clips are used to compensate and fill target audio duration. If 100% of clips are invalid, it throws with full diagnostic details.
     - In `FinalExportTab.tsx`: Added `shuffleVideoClips` state (default: `true`), sent `shuffle: shuffleVideoClips` in payload, and added clean UI checkbox "Xáo trộn thứ tự video" (strictly NO icon/emoji, conforming to `AGENTS.md` and `GEMINI.md`).
  4. Autopilot video export synchronization (`backend/autopilot/autopilotRunner.ts`):
     - Changed `shuffle: false` to `shuffle: true` in `jobRequest` so fallback paths in Final Export never revert to sequential 0, 1, 2... clip ordering.
  5. Merge Videos Tab (`backend/video/mergeVideosSimple.ts`, `src/pages/Video/MergeTab.tsx`):
     - Handled small clip pool duplicate permutations gracefully with warnings instead of throwing fatal errors.
     - Set `shuffleOrder` default to `true` in `MergeTab.tsx` so users merging videos get diverse mixes by default.
- Files: [backend/video/utils/videoPlaylistPlan.ts](backend/video/utils/videoPlaylistPlan.ts), [backend/video/utils/videoShuffleHelpers.ts](backend/video/utils/videoShuffleHelpers.ts), [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [backend/video/mergeVideosSimple.ts](backend/video/mergeVideosSimple.ts), [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx), [src/pages/Video/MergeTab.tsx](src/pages/Video/MergeTab.tsx), [tests/unit/backend/videoPlaylistPlan.test.ts](tests/unit/backend/videoPlaylistPlan.test.ts), [tests/unit/backend/videoShuffleHelpers.test.ts](tests/unit/backend/videoShuffleHelpers.test.ts), [HANDOFF.md](HANDOFF.md).
- Verification: 142/142 tests passed across 21 test suites in vitest, `npm run build` compiled 100% cleanly.

## 2026-10-13 — Synchronize Autopilot with multi-genre & playlistEngine sub-features

- Changed:
  1. Autopilot audio export synchronization (`backend/autopilot/autopilotRunner.ts`, `backend/music/exportAudio.ts`, `src/types/ipc.ts`):
     - Identified & resolved critical sync gap: Autopilot scans music with `persist: false`, leaving `scanStore` on disk unaware of Autopilot tracks. When crossfade duration compensation was triggered, `exportPlaylistToFile` previously attempted to load unrelated stale tracks from disk or failed.
     - Added optional `scanResult?: ScanMusicResult` to `ExportPlaylistRequest` and `exportPlaylistToFile` so in-memory scan results are used directly without touching stale disk caches.
     - Passed `genreId: 'autopilot'`, `genreName: 'Autopilot'`, and `genreSettings` to `buildOptions` in `autopilotRunner.ts`.
     - Passed `scanResult: scan` directly into `req` in `exportPlaylistToFile` within `autopilotRunner.ts`.
     - Crossfade duration compensation now strictly scopes filler tracks to Autopilot's own scanned tracks and never contaminates with other genres or disk remnants.
  2. Verified `playlistEngine` variant exhaustion handling: Autopilot cleanly catches candidate variant exhausted errors and logs them into `failedDays` without crashing the process.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [src/types/ipc.ts](src/types/ipc.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Verification: 34/34 tests passed across 4 test suites, `npm run build` compiled 100% cleanly.

## 2026-10-13 — Multi-genre export collision prevention, custom naming, inline playlist rename, and UI icon cleanup

- Changed:
  1. Multi-genre export naming & anti-overwrite (`src/pages/Music/exportNamingUtils.ts`, `src/pages/Music/ExportAudioPage.tsx`):
     - Added `resolveBatchFileNames` and `buildPlaylistExportFileName`: automatically handles Vietnamese diacritics (`đ`/`Đ` -> `d`/`D`, NFKD normalization), safely generates collision-free export filenames.
     - Automatically attaches genre prefix when exporting multiple genres or sharing the same folder, plus numeric suffix (`_2`, `_3`...) if collision occurs.
     - Added custom genre export name input for each genre with localStorage persistence (`export_genre_custom_names`).
     - Added 1-click button "Chọn 1 thư mục chung cho tất cả thể loại" to assign a common directory across all genres.
     - Added inline playlist rename ("Đổi tên" button, text input with "Lưu" / "Hủy" or Enter/Escape).
     - Added real-time filename preview (`File: [filename].m4a`) under each playlist card.
     - Unified `handleExport` to delegate to `runExportQueue(selectedPlaylistIds)`, eliminating duplicated and un-synced export logic.
  2. UI/UX icon reduction & strict rules update:
     - Stripped decorative emojis/icons across UI pages (`ExportAudioPage.tsx`, `MergeTab.tsx`, `PoolMonitorTab.tsx`, `YouTubeDownloaderTab.tsx`, `AutopilotPage.tsx`).
     - Added strict project-wide rule to `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`: **TUYỆT ĐỐI KHÔNG TỰ Ý THÊM ICON / EMOJI VÀO GIAO DIỆN (UI)**. Giao diện luôn giữ phong cách tối giản, chuyên nghiệp, dùng text rõ nghĩa thay vì icon màu mè.
- Files: [src/pages/Music/exportNamingUtils.ts](src/pages/Music/exportNamingUtils.ts), [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [src/pages/Video/MergeTab.tsx](src/pages/Video/MergeTab.tsx), [src/pages/Autopilot/PoolMonitorTab.tsx](src/pages/Autopilot/PoolMonitorTab.tsx), [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md), [GEMINI.md](GEMINI.md), [tests/unit/pages/exportNamingUtils.test.ts](tests/unit/pages/exportNamingUtils.test.ts), [HANDOFF.md](HANDOFF.md).
- Verification: 20/20 unit tests passed, `npm run build` compiled cleanly, dev desktop hot-reloaded.

## 2026-10-13 — Fix genre mixing across Features 1-4 (Quét nhạc → Tạo playlist → Nghe thử → Xuất nhạc)

- Changed:
  1. Quét nhạc (`backend/music/scanMusic.ts`, `backend/music/scanStore.ts`):
     - Cách ly thư mục quét theo từng thể loại độc lập (`genreSeenRealPaths` riêng theo từng genre). Các thể loại không còn tranh chấp hay chặn file của nhau.
     - Cho phép chia sẻ thư mục mở đầu (`openingFolders`) giữa các thể loại mà không làm mất bài ở thể loại sau.
     - Scoped `track.id` theo `genreId` (`hash(genreId:canonicalPath)`) để mỗi thể loại sở hữu danh sách track độc lập, không bị đụng độ ID trong store. Cập nhật `isCurrentTrackId` tương thích ngược cả scoped ID lẫn raw hash.
  2. Tạo playlist (`backend/music/playlistEngine.ts`, `src/pages/Music/CreatePlaylistPage.tsx`):
     - Lọc phòng vệ tuyệt đối: khi tạo playlist cho một thể loại, `buildPlaylists` chỉ nhận các bài thuộc đúng `genreId` đó, lọc bỏ mọi bài lọt từ thể loại khác.
     - Đặt tên playlist rõ ràng theo thể loại: `${genreName} - Playlist ${index + 1}` (thay vì tên chung `Playlist ${index + 1}` gây trùng lặp).
     - Gắn trường `genreId`, `genreName`, `genreSettings` trực tiếp vào `PlaylistDefinition`.
     - Lọc `pinnedTrackIds` ở card thể loại chỉ giữ các ID thuộc đúng body track của thể loại đó.
  3. Xuất nhạc (`backend/music/exportAudio.ts`, `src/pages/Music/ExportAudioPage.tsx`):
     - Sửa triệt để bug rò rỉ bài: khi bù thời lượng do crossfade (`durationDiff > 5.0`), `exportAudio` CHỈ lấy bài bù thuộc đúng `playlist.genreId` từ `scanResult`. Tuyệt đối không lấy bài từ thể loại khác; nếu hết bài chưa dùng trong thể loại, chỉ tái sử dụng bài trong chính thể loại đó.
     - Thêm tiền tố thể loại vào tên file xuất (`fileName`) nếu chưa có trong tên playlist, ngăn chặn việc 2 thể loại cùng tên `Playlist 1` ghi đè lẫn nhau khi xuất vào cùng thư mục.
- Files: [backend/music/scanMusic.ts](backend/music/scanMusic.ts), [backend/music/scanStore.ts](backend/music/scanStore.ts), [backend/music/playlistEngine.ts](backend/music/playlistEngine.ts), [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [tests/unit/backend/genreIsolation.test.ts](tests/unit/backend/genreIsolation.test.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: Quy tắc xoay vòng 4 nhóm (Opening → Pinned → Priority → Random), tính tất định của LRU pool, crossfade compensation, Windows path safety, và tương thích ngược với scan cache cũ.
- Verification: 173/173 tests trong 31 test files passed 100% (bao gồm 4/4 test mới trong `genreIsolation.test.ts` kiểm thử toàn bộ luồng Quét nhạc, Tạo playlist, Xuất nhạc không trộn thể loại), `npm run build` compiled thành công cả client lẫn electron bundle.

## 2026-10-13 — Finalize Opening → Pinned → Priority → Random variant playlist logic

- Changed: Enforced strict 4-group order (Opening → Pinned → Priority → Random), removed double rotation on pinned tracks, preserved all pinned tracks without premature targetSec break, made `sortByLRU` deterministic by removing random shuffle, implemented multi-group candidate variant generation across Opening/Pinned/Priority/Random, and checked full ordered pipe-delimited signatures (`openingId|pinnedId1|pinnedId2|priorityId1|randomId1`) with explicit error throwing when variants are exhausted.
- Files: [backend/music/playlistEngine.ts](backend/music/playlistEngine.ts), [backend/music/musicPool.ts](backend/music/musicPool.ts), [tests/unit/backend/playlistEngineRotation.test.ts](tests/unit/backend/playlistEngineRotation.test.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: Opening rotation per playlist, ratio calculations, ending tracks append semantics, crossfade duration inflation, and error throwing contract on variant exhaustion.
- Verification: 10/10 playlist unit tests passed (including exact user specification example `P1: O1 → A → B → P1 → P2 → R1 → R2`, `P2: O2 → B → A → P2 → P3 → R2 → R3`, `P3: O1 → A → B → P3 → P1 → R3 → R1`), full backend test suite passed 19 files / 124 tests, and `npm run build` compiled successfully.
- Follow-up: test Create Playlist in UI with Opening tracks, 2+ pinned tracks, and verify generated playlist signatures and preview order.

## 2026-10-10 — Make playlist group rotation deterministic

- Changed: Playlist generation now applies one deterministic rotation per Opening/Pinned/Priority/Random group, removes duplicate pinned rotation, and compares complete ordered track-ID sequences with an unambiguous signature.
- Files: [backend/music/playlistEngine.ts](backend/music/playlistEngine.ts), [tests/unit/backend/playlistEngineRotation.test.ts](tests/unit/backend/playlistEngineRotation.test.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: Opening → Pinned → Priority → Random → Ending ordering, shared track reuse across playlists, per-playlist duration/ratio behavior, ending stats, and no-consecutive-duplicate intent.
- Verification: focused playlist suite passed 4 files / 24 tests; `npm run build`, typecheck, and manual UI smoke remain pending.
- Follow-up: run Function 2 with 2–4 pinned tracks and multiple opening tracks; confirm each full ordered sequence is unique and shared tracks remain allowed.

## 2026-10-10 — Show actual music export processing mode

- Changed: Function 4 progress now shows whether current playlist is using `Loudnorm + re-encode`, `Crossfade + re-encode`, or `Stream-copy/AAC encode`.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: export commands, duration, bitrate, cancellation, output path, and retry behavior.
- Verification: `npm run build` passed; `tests/unit/backend/exportAudio.test.ts` passed 6/6.
- Follow-up: compare visible mode with `[ExportAudio]` logs during normalized AAC and crossfade exports.


## 2026-10-10 — Clean partial audio normalization output on cancel/fail

- Changed: Function 1 now removes the target output file when FFmpeg normalization fails or is cancelled, preventing corrupt partial `.m4a`/audio files from appearing successful on the next scan.
- Files: [backend/music/normalizeAudio.ts](backend/music/normalizeAudio.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: AAC bitrate settings, MP3/WAV/FLAC/keep formats, backup source behavior, output folder semantics, and cancellation status.
- Verification: AAC 128/192/256/320/384 smoke outputs reported matching codec, 48kHz stereo, 60s duration, and requested bitrate range; MP3/FLAC converted to AAC successfully; esbuild/diff checks passed. Cancellation fixture exposed and is now cleaned by code path.
- Follow-up: run Function 1 against real user files and cancel through IPC; confirm no partial output remains.

## 2026-10-10 — Stabilize AAC bitrate normalization

- Changed: AAC normalization now disables native AAC perceptual tools (`aac_pns`, `aac_tns`, `aac_is`, `aac_ms`) that caused simple audio to undershoot selected bitrate dramatically; target bitrate remains explicit with AAC codec, 48kHz, stereo output.
- Files: [backend/music/normalizeAudio.ts](backend/music/normalizeAudio.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: MP3/WAV/FLAC/keep formats, source protection, backup option, cancellation, output-folder behavior, loudness preset behavior, and duration semantics.
- Verification: bundled FFmpeg fixture measured ~244 kbps for requested 384 kbps before fix and ~386 kbps after fix on 60s stereo noise; esbuild syntax check and `git diff --check` passed. Dedicated normalize unit fixture is still pending.
- Follow-up: normalize one real MP3/WAV/FLAC file at 128/192/256/320/384 kbps, probe codec/bitrate/sample rate/channels, verify output path and cancel cleanup.

## 2026-10-10 — Remove duplicate playlist controls

- Changed: Removed the duplicated Crossfade/Loudnorm/seconds row from each genre card; one settings row remains and controls the active genre.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: Crossfade/Loudnorm values, per-genre settings, guide content, and playlist generation behavior.
- Verification: `npm run build` passed; playlist tests passed 2/2.
- Follow-up: refresh Function 2 and confirm each genre card shows exactly one Crossfade/Loudnorm row.

## 2026-10-10 — Add Playlist Guide button

- Changed: Function 2 now has a `Hướng dẫn` button next to `Lưu cài đặt`, explaining Crossfade, Loudnorm, pinned-first music, ending music, and playlist creation flow.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: existing settings, genre cards, pinned/ending selections, and playlist generation logic.
- Verification: `npm run build` passed; playlist tests passed 2/2. Direct esbuild command failed due local esbuild executable wrapper, but Vite build compiled the page successfully.
- Follow-up: open Function 2, click `Hướng dẫn`, verify panel visibility and text at desktop/mobile widths.

## 2026-10-10 — Restore pinned-track search and clarify playlist labels

- Changed: Playlist cards now label the feature `Nhạc ghim đứng đầu playlist`, restore a per-genre song-name search field, and label ending tracks `Nhạc cuối playlist`.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: pinned tracks remain mutually exclusive with ending tracks and playlist engine ordering still places pinned music first; ending-track behavior unchanged.
- Verification: esbuild UI syntax check passed; playlist opening/genre tests passed 2/2.
- Follow-up: open Create Playlist with a large genre, search a song, pin/unpin it, create playlist, and confirm first track/order in preview.

## 2026-10-01 — Align scan IPC source contracts

- Changed: Video/image scan IPC payloads now require non-null source types where schemas/handlers already require them; `scanImageSource` is required in `IPCAPI` and renderer no longer silently optional-chains it.
- Files: [src/types/ipc.ts](src/types/ipc.ts), [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: existing channels, preload exposure, main validation, and scan behavior.
- Verification: type/syntax check and focused IPC/renderer tests pending; full suite baseline was 33 files/222 tests before this batch.
- Follow-up: run TypeScript/IPC contract checks and scan image/video with valid and missing source payloads.

## 2026-10-01 — Guard output/source collisions and expose audio scan failures

- Changed: Final export rejects any planned output path that resolves to an audio/video/priority/ending source path, preventing overwrite or delete-source data loss. Audio scan results now carry requested count and rejected-file diagnostics; image scan items expose optional dimensions in the shared contract.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: no-clobber behavior for unrelated existing outputs, source ordering, duration semantics, and existing IPC channels.
- Verification: esbuild checks and `git diff --check` passed. Real collision/invalid-audio IPC tests remain pending.
- Follow-up: test output filename equal to an input path, all-invalid audio scan, and renderer display of rejected audio details.

## 2026-10-01 — Cancel Autopilot backend after Batch Mode timeout

- Changed: Batch Mode timeout now sends `autopilot.cancel()` before rejecting its wait, preventing backend FFmpeg/scan work from continuing after the UI timeout.
- Files: [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: normal polling, user cancel flow, batch ordering, and terminal status handling.
- Verification: focused UI syntax/build check pending; timeout smoke test remains pending.
- Follow-up: force a short test timeout, verify backend enters cancelling/idle and no next batch starts.

## 2026-09-30 — Complete Windows package and full test gate

- Changed: Completed portable and NSIS packaging after enabling store compression; no publish/upload performed.
- Files: [electron-builder.json5](electron-builder.json5), [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build` passed; full Vitest passed 33 files / 222 tests with 2 intentionally skipped; portable EXE `dist-electron-output-portable2/93-media-tool-mix-nhac-4.5.2-portable.exe` built; NSIS installer `dist-electron-output-nsis/93-media-tool-mix-nhac-setup-4.5.2.exe` built; unpacked resources include FFmpeg, FFprobe, yt-dlp, and browser cookie extractor.
- Warnings: existing Vite dynamic-import/font/hash warnings, duplicate dependency references, default Electron icon, and GPU fallback warnings remain. No packaged real-media smoke run yet.
- Follow-up: launch packaged portable/installed app, run one short audio/video export and one cancel/retry case; verify updater/auth guard and downloader cookie extraction on Windows.

## 2026-09-30 — Complete portable package build with low-memory compression

- Changed: electron-builder uses `compression: 'store'` to avoid 7-Zip memory exhaustion while packaging the ~1.36 GiB Windows media bundle.
- Files: [electron-builder.json5](electron-builder.json5), [HANDOFF.md](HANDOFF.md).
- Verification: `npx electron-builder --config electron-builder.json5 --config.directories.output=dist-electron-output-portable2 --win portable --config.win.target=portable` passed; portable EXE exists and packaged FFmpeg/FFprobe/yt-dlp/browser cookie extractor resources verified.
- Risk: portable artifact is larger because compression is disabled; NSIS installer build still pending and no publish performed.
- Follow-up: build NSIS with same config, launch packaged portable for media smoke, then decide whether archive size is acceptable.

## 2026-09-30 — Complete auth mock and verification test gate

- Changed: Completed Electron mock surface required by auth regression tests (`protocol`, lifecycle, IPC listener/removal, BrowserWindow stub, and dev-auth helper).
- Files: [tests/e2e/auth.e2e.ts](tests/e2e/auth.e2e.ts), [backend/video/outputVerification.ts](backend/video/outputVerification.ts), [HANDOFF.md](HANDOFF.md).
- Verification: auth suite passed 16/16 executed tests (2 real-launch tests skipped); output verification passed 14/14; focused lifecycle suite passed 35/35; `npm run build` passed.
- Follow-up: rerun full Vitest and package portable/NSIS on a host with enough 7-Zip memory; current unpacked package already passes resource presence checks.

## 2026-09-30 — Complete focused release gate checks

- Changed: Corrected the existing Autopilot validation-label regression and expanded decode verification error matching so code-0 FFmpeg output with explicit `Error` stderr fails as intended.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [backend/video/outputVerification.ts](backend/video/outputVerification.ts), [tests/e2e/auth.e2e.ts](tests/e2e/auth.e2e.ts), [HANDOFF.md](HANDOFF.md).
- Verification: focused Autopilot/JobQueue/YouTube suite passed 35/35; output verification suite passed 14/14; `npm run build` passed. Full Vitest now reaches tests but still has a separate Electron mock failure in `tests/e2e/auth.e2e.ts` (`electron` mock lacks `protocol` export); portable archive remains blocked by 7-Zip memory.
- Follow-up: fix the auth test mock contract, rerun full suite, and build portable/NSIS on a machine with enough archive memory.

## 2026-09-30 — Verify unpacked Windows package resources

- Changed: Ran electron-builder Windows unpacked packaging after adding browser cookie extractor resource; verified packaged `resources/bin/ffmpeg.exe`, `ffprobe.exe`, `yt-dlp.exe`, and `resources/python/browser_cookie_extractor.py` exist.
- Files: [electron-builder.json5](electron-builder.json5), [HANDOFF.md](HANDOFF.md).
- Verification: `npx electron-builder --config electron-builder.json5 --win --dir` passed; resource check passed. Portable archive still fails 7-Zip with `Can't allocate required memory` while archiving ~1.36 GiB; no installer/portable artifact accepted.
- Follow-up: build portable/NSIS on a machine with sufficient 7-Zip memory or reduce packaged payload after explicit size review; do not publish current archive.

## 2026-09-30 — Normalize Autopilot validation label and focused test baseline

- Changed: Restored accented root-video validation label so the existing regression assertion matches user-facing diagnostics.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Verification: focused Autopilot/JobQueue/YouTube suite passed 35/35; build remains independently verified, package build blocker documented below.
- Follow-up: run full suite and release artifact build after resolving resource/archive memory constraints.

## 2026-09-30 — Package browser cookie extractor resource

- Changed: electron-builder now copies `backend/python/browser_cookie_extractor.py` to packaged `resources/python/browser_cookie_extractor.py`, matching `browserCookieService.ts` lookup paths.
- Files: [electron-builder.json5](electron-builder.json5), [HANDOFF.md](HANDOFF.md).
- Preserved: existing FFmpeg/FFprobe/yt-dlp/security/scripts resources and development path lookup.
- Verification: existing `4.5.2-r2` artifact contains FFmpeg/FFprobe/yt-dlp but lacks cookie extractor; config change syntax/build verification pending.
- Follow-up: build portable/installer and assert `resources/python/browser_cookie_extractor.py` exists in both outputs.

## 2026-09-30 — Preserve structured partial Autopilot results

- Changed: Final export results with at least one valid output now return to Autopilot as partial results instead of throwing a second aggregate error after `done`; day summaries carry failed video jobs and rejected audio diagnostics with repair hints. Zero-output failures still throw.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: all-valid success, all-failed error, existing audio duration validation, and cancellation terminal behavior.
- Verification: esbuild syntax check and `git diff --check` passed. Partial-day real-media smoke test remains pending.
- Follow-up: run three playlists with one rejected audio and one failed video; assert one `completed_with_errors` result with valid output retained and no later contradictory error.

## 2026-09-30 — Stop final-export planning when request is cancelled

- Changed: `planFinalExport` accepts request identity and checks cancellation after audio/video planning scans; Autopilot passes its request ID so large planner scans cannot continue into FFmpeg after cancel.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: planning order, audio duration semantics, slideshow/priority planning, and existing request payloads.
- Verification: esbuild syntax checks and `git diff --check` passed. Large network-folder cancellation smoke test remains pending.
- Follow-up: cancel during audio/video planning and assert no final job starts and terminal cancellation reaches JobQueue.

## 2026-09-30 — Register Autopilot export activity with main teardown guard

- Changed: Autopilot start now marks main-process export activity active for the full background run and clears it in `finally`, so updater/auth/quit guards see active Autopilot media work.
- Files: [electron/handlers/autopilotHandlers.ts](electron/handlers/autopilotHandlers.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: renderer export activity tracking and Autopilot IPC channels.
- Verification: esbuild syntax check and `git diff --check` passed. Packaged quit/updater smoke test remains pending.
- Follow-up: start Autopilot, attempt update/quit during active FFmpeg, verify guard remains active until pipeline teardown.

## 2026-09-30 — Reject timed-out output decode verification

- Changed: FFmpeg decode verification timeout now fails verification instead of accepting an unverified/corrupt output as valid. Timeout reason remains in diagnostics.
- Files: [backend/video/outputVerification.ts](backend/video/outputVerification.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: decode window, timeout duration, stderr capture, and normal code-0 verification behavior.
- Verification: source inspection and diff check pending; timeout fixture test remains required.
- Follow-up: test a deliberately slow/blocked decode and a large valid file; ensure timeout is reported as failure with no output publish.

## 2026-09-30 — Cancel YouTube children during handler cleanup

- Changed: YouTube handler cleanup now requests cancellation of all downloader-managed yt-dlp processes before removing listeners and dropping the downloader singleton.
- Files: [electron/youtube/youtubeHandlers.ts](electron/youtube/youtubeHandlers.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: cookie storage, downloader reuse, IPC channels, and bounded downloader cancellation behavior.
- Verification: focused YouTube tests remain 10/10 after the preceding downloader batch; handler syntax check pending.
- Follow-up: quit app during channel/concurrent/metadata yt-dlp activity on Windows and confirm child processes exit.

## 2026-09-30 — Validate downloader metadata URLs and track listing processes

- Changed: YouTube metadata/channel/size IPC handlers now reject unsupported URLs before yt-dlp; direct metadata/channel listing yt-dlp processes register in the downloader active-process registry so cancel/shutdown can terminate them.
- Files: [electron/youtube/youtubeHandlers.ts](electron/youtube/youtubeHandlers.ts), [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: download formats, cookie resolution, bounded retries, channel output structure, and existing single-download process tracking.
- Verification: esbuild syntax checks for downloader and handlers passed. Focused downloader smoke/cancel tests pending.
- Follow-up: validate YouTube/Facebook/TikTok metadata URLs, cancel channel listing during yt-dlp, and quit app during listing; confirm child process teardown.

## 2026-09-30 — Bound Autopilot video scan and stop on cancel

- Changed: Recursive video collection now shares a hard 50,000-entry cap, checks cancellation while walking, avoids unbounded recursive accumulation, and aborts before merging/shuffling after scan cancellation.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: folder bucketing, percent/minimum selection policy, summary counts, and video ordering within collected results.
- Verification: esbuild syntax check and `git diff --check` passed. Large-folder/cancel smoke test remains pending.
- Follow-up: scan a large nested root and cancel during traversal; verify bounded memory, no later video export, and actionable cap warning.

## 2026-09-30 — Refuse concurrent Autopilot start after stale heartbeat

- Changed: Stale heartbeat no longer resets Autopilot singleton state to idle while old async work may still run. `forceResetAutopilot()` now initiates cancellation and keeps teardown ownership instead of reporting a fake reset.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: normal start/cancel flow, active run token ownership, and existing progress/log channels.
- Verification: esbuild syntax check and `git diff --check` pending after this batch; long silent-run smoke test remains required.
- Follow-up: hold a run in silent planning/FFmpeg, attempt second start, assert rejection; force reset must not allow a new run until old teardown completes.

## 2026-09-30 — Stage final video output before publish

- Changed: Each final-export job now writes to a request/job scratch output, verifies that staged file, then replaces the planned output path only after verification. Failed staged output is removed; stale final output is not used as verification input and retry can regenerate the same filename.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: no-clobber planning for unrelated existing outputs, output naming, verification rules, and atomic-ish same-drive publish flow.
- Verification: esbuild syntax check and `git diff --check` passed. Real FFmpeg failure/retry smoke test remains pending.
- Follow-up: inject FFmpeg failure with an existing output, verify stale output is not accepted, failed staged output is cleaned, and rerun succeeds.

## 2026-09-30 — Fence FinalExport UI restore, cancel, and source scans

- Changed: FinalExport restore now restores `isExportingRef` and numeric queue progress correctly; progress/done/error listeners reject events without the active request identity or after cancellation; source scan results use a generation guard; files-mode status reports backend-valid count instead of raw selected count.
- Files: [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: existing IPC channels, request IDs, scan payloads, export activity registration, and output mapping.
- Verification: esbuild syntax check and `git diff --check` passed. Real remount/late-event UI smoke test remains pending.
- Follow-up: select source A then B with delayed scan A, remount during active export, cancel, and assert stale events cannot resurrect or overwrite state.

## 2026-09-30 — Register pretranscode children under parent cancellation

- Changed: Pretranscode FFmpeg children are now registered under both parent request ID and child ID, so parent cancellation can kill quiet active workers immediately while child-specific cancellation remains identity-safe.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: GPU/CPU fallback, worker retry flow, child identity cleanup, and shared transcode cache behavior.
- Verification: esbuild syntax check and `git diff --check` passed. Windows quiet-process cancellation smoke test remains pending.
- Follow-up: cancel during silent pretranscode and assert process exits before timeout and no later job starts.

## 2026-09-30 — Treat Autopilot cancellation as terminal day failure

- Changed: `runAutopilotForDay` now throws through cancellation checkpoints after audio export and video selection instead of returning early; outer orchestration can emit one cancellation terminal state without dereferencing an undefined day result or marking a cancelled day successful.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: normal partial-audio handling, valid output generation, and existing cancellation controller behavior.
- Verification: esbuild syntax checks for Autopilot and final export passed; `git diff --check` passed. Focused Autopilot suite remains 12/13 because one pre-existing validation-message assertion uses an unaccented label mismatch.
- Follow-up: exercise cancel during Step 2 and Step 3 with real FFmpeg; assert no success-day log is emitted.

## 2026-09-30 — Full-audit fallback checkpoint

- Changed: Created fallback commit `779c9f5` containing the pre-audit repository source/test state; excluded untracked build dumps, `.omc` session state, logs, extracted releases, and temporary debug files.
- Files: all tracked source/test changes already present in the worktree; no new product behavior added by this checkpoint.
- Why: User requested a safe rollback point before full-tool audit and phased remediation.
- Follow-up: Audit parent tree read-only first; do not reset or clean untracked artifacts without explicit approval. Implement only approved P0/P1 batches, one batch per review boundary.

## 2026-09-30 — Stop final export cleanly on cancellation

- Changed: Final export now aborts cancellation before recording a failed job, before emitting `done`, and before source deletion. Cancelled jobs no longer continue later outputs or delete successful inputs.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: partial success behavior for non-cancellation failures, existing output verification, source deletion on successful completion, and cancellation request IDs.
- Verification: esbuild syntax checks for `backend/video/finalExport.ts` and `backend/autopilot/autopilotRunner.ts` passed; `git diff --check` passed. `tests/unit/backend/autopilotRunner.test.ts` ran 12/13 tests; one pre-existing validation-message assertion failed because expected `Thư mục gốc Video đã cắt` but received `Thu muc goc Video da cat`. Focused cancellation smoke test with real FFmpeg remains pending.
- Follow-up: cancel a three-job export during job 2 with `deleteSourceFiles=true`; verify no `done` event, job 3 does not start, and source files remain.

## 2026-09-30 — Add per-audio and per-video Autopilot export diagnostics

- Changed: Final export now records rejected audio paths with validation/probe/duration stage, bounded technical detail, observed metadata, and repair hint; failed video jobs include audio path, output path, stage, source clips, and repair hint. Autopilot logs requested/accepted/rejected audio counts and names each audio/video failure before reporting partial output.
- Files: [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts), [src/types/ipc.ts](src/types/ipc.ts), [HANDOFF.md](HANDOFF.md).
- Preserved: existing audio duration acceptance rule, sequential job execution, FFmpeg retry/cancellation, output mapping, and partial-success behavior.
- Verification: `git diff --check` passed. Focused Vitest/build were blocked by temporary tool classifier unavailability; real-media smoke test pending.
- Follow-up: Run Autopilot with three playlists and verify logs identify each rejected `Pxx.m4a`, failed output video, stage, technical cause, and repair step; then rerun after fixing listed files.

## 2026-09-21 — Browser-session Spotify metadata pagination

- Changed: When Spotify cookies exist, metadata import now opens an isolated hidden Spotify browser session, applies cookies in main process, scrolls lazy-loaded playlist rows with bounded limits, deduplicates and returns full metadata; HTML fallback remains when cookies are absent.
- Files: [electron/spotifyMetadataBrowser.ts](electron/spotifyMetadataBrowser.ts), [backend/music/spotifyMeta.ts](backend/music/spotifyMeta.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [electron/youtube/youtubeHandlers.ts](electron/youtube/youtubeHandlers.ts), [HANDOFF.md](HANDOFF.md).
- Root cause: Single HTML request exposed only 29 server-rendered rows; cookie alone does not trigger Spotify web-player lazy pagination.
- Privacy: Hidden session is isolated and destroyed after import; cookies stay main-process-only; collection returns only artist/title/track IDs; no Spotify audio, playback endpoints, tokens, or DRM bypass.
- Verification: Focused tests passed 2 files, 18 tests; `npm run build` passed with existing warnings; manual 200+ playlist smoke test pending.
- Follow-up: Restart app, re-import Spotify cookie, import playlist, verify count exceeds 29 before YouTube download. Browser scroll now waits for initial render, scrolls smaller increments, dispatches wheel events, and allows 240 bounded passes.

## 2026-09-21 — Use imported Spotify cookies for metadata

- Changed: Cookie Manager now recognizes Spotify cookie exports; Spotify metadata requests use the stored Spotify cookie string in main process to improve full-playlist metadata extraction.
- Files: [backend/youtube/cookieManager.ts](backend/youtube/cookieManager.ts), [backend/music/spotifyMeta.ts](backend/music/spotifyMeta.ts), [electron/youtube/youtubeHandlers.ts](electron/youtube/youtubeHandlers.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [HANDOFF.md](HANDOFF.md).
- Preserved: Cookies never reach renderer/logs; cookie use is metadata-only; no Spotify audio/DRM access; existing YouTube MP3/ZIP pipeline unchanged.
- Verification: `npx vitest run tests/unit/backend/spotifyMeta.test.ts tests/unit/backend/youtubeDownloader.test.ts --reporter=verbose` passed 2 files, 18 tests; `npm run build` passed with existing warnings; `git diff --check` passed.
- Follow-up: Import Spotify cookie JSON, confirm platform shows Spotify, re-import playlist, verify track count and then run YouTube download.

## 2026-09-21 — Link-only public Spotify metadata import

- Changed: Spotify import now tries public Spotify page metadata first, so public playlist/album/track links no longer require `SPOTIFY_ACCESS_TOKEN`; existing YouTube search → MP3/ZIP flow remains unchanged.
- Files: [backend/music/spotifyMeta.ts](backend/music/spotifyMeta.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [tests/unit/backend/spotifyMeta.test.ts](tests/unit/backend/spotifyMeta.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: User expects link-only import after Spotify Developer Dashboard access failed.
- Privacy: Main process fetches only public HTML metadata with bounded timeout/size; no Spotify cookies, Authorization header, preview URL, audio URL, DRM bypass, or renderer token. Configured API token remains optional fallback only.
- Verification: `npx vitest run tests/unit/backend/spotifyMeta.test.ts tests/unit/backend/youtubeDownloader.test.ts --reporter=verbose` passed 2 files, 18 tests; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed. Real public Spotify HTML smoke depends on upstream response variability and was tested with captured public track-row markup.
- Follow-up: Restart dev app, test one public playlist without `SPOTIFY_ACCESS_TOKEN`, then run YouTube MP3/ZIP download; private/blocked pages should show readable error.

## 2026-09-21 — Spotify metadata to YouTube audio batch

- Changed: YouTube Downloader now accepts already-imported Spotify metadata, searches up to five accessible YouTube results per track, applies artist/title matching with cover/live penalties, downloads matched audio through existing yt-dlp/FFmpeg flow, and can create `spotify-playlist.zip`.
- Files: [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts), [backend/youtube/types.ts](backend/youtube/types.ts), [electron/youtube/youtubeHandlers.ts](electron/youtube/youtubeHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Make existing Spotify metadata import useful for authorized YouTube-source audio downloads without accessing Spotify audio or bypassing Spotify DRM.
- Preserved: Spotify access token remains main-process-only; existing YouTube cookies, bounded yt-dlp retries, job queue, progress, cancellation, FFmpeg conversion, and user-selected output folder behavior.
- Verification: `npx vitest run tests/unit/backend/youtubeDownloader.test.ts tests/unit/backend/spotifyMeta.test.ts --reporter=verbose` passed 2 files, 15 tests; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed. `npx tsc --noEmit` remains blocked by pre-existing TS6305 generated declaration/composite-project errors.
- Follow-up: Verify one short public track, a no-match result, ZIP creation, duplicate-safe names, and cancellation on Windows; real YouTube smoke test requires user network and accessible source.

## 2026-09-11 — Keep function 5 folder import responsive

- Changed: Function 5 now uses recursive `ultraFastScanFolder` for folder imports and skips per-file FFprobe metadata checks; empty/non-MP4 folders show actionable errors.
- Files: [src/pages/Video/ExtractAudioTab.tsx](src/pages/Video/ExtractAudioTab.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Selecting a large folder made the renderer appear frozen while probing every video before displaying the list.
- Preserved: MP4-only filtering, existing `video:extractAudioBatch` pipeline, MP3/WAV output, progress, cancellation, no-overwrite naming, and generic Video → Tách âm thanh behavior.
- Verification: `npm run build` passed before this UI-only follow-up; live renderer DOM is responsive and displays function 5. Manual folder selection with a large folder remains pending.
- Follow-up: Select a large folder in function 5 and confirm MP4 rows appear quickly before conversion starts.

## 2026-09-11 — Replace function 5 with MP4-to-audio conversion

- Changed: Function 5 route `/music/song-nhac` now opens MP4 → Audio instead of Song Nhạc visualizer; supports batch MP4 selection and MP3/WAV output.
- Files: [src/pages/Music/Mp4ToAudioPage.tsx](src/pages/Music/Mp4ToAudioPage.tsx), [src/pages/Video/ExtractAudioTab.tsx](src/pages/Video/ExtractAudioTab.tsx), [src/router.tsx](src/router.tsx), [src/components/Sidebar.tsx](src/components/Sidebar.tsx), [electron/preload.ts](electron/preload.ts), [HANDOFF.md](HANDOFF.md).
- Why: Add requested MP4-to-audio conversion directly under sidebar function 5 while reusing existing extraction pipeline.
- Preserved: Existing `video:extractAudioBatch` IPC contract, FFmpeg MP3/WAV encoding, progress, cancellation, no-overwrite output naming, per-file failure reporting, and Video → Tách âm thanh tab behavior.
- Hardening: Typed preload progress/request/result contracts; enforce MP4 mode and request ID validation in main; prevent duplicate extraction jobs; reject request IDs already used by video jobs; use UUID-only temp basenames; scale and clamp batch progress; cancel on renderer destruction and during probe/publish boundaries; clear cancellation state in all completion paths; skip unnecessary per-file FFprobe on Function 5 folder import to keep UI responsive.
- Verification: final `npm run build` passed with existing Vite dynamic-import/font/hash-sentinel warnings; final `npx vitest run tests/unit/backend/extractAudio.test.ts --testTimeout=15000 --reporter=verbose` passed 2/2; `npx tsc --noEmit` is blocked by existing TS6305/TS6306 generated declaration/composite-project errors; `npm run lint` is blocked because `eslint` is not installed/resolvable in this checkout.
- Follow-up: Manually open function 5, convert one/multiple MP4 files to MP3 and WAV, cancel a run, and confirm `_audio` outputs without overwriting existing files.

## 2026-08-27 — Rebuild 4.5.2 with partial-playlist continuation

- Changed: Rebuilt Windows 4.5.2 installer/portable after short-playlist handling fix. Valid audio playlists continue to video export; materially short playlists are reported/skipped.
- Files: generated `dist-electron-output-4.5.2-r2/`, [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build` passed; installer `369436384` bytes; portable `369206259` bytes; `latest.yml` reports `4.5.2`; packed ASAR main hash matches loose bundle (`91BC71DBD57C5C129285EAC096C2B88286519705D2B0CF1F92D2BD2DF1220DCA`); packed code contains short-playlist continuation and `validPlaylists` mapping. No upload/publish.
- Warnings: existing dynamic imports, unresolved fonts, hash sentinel, duplicate dependencies, default Electron icon, and `DEP0190`. Standard output remains separate/locked.
- Follow-up: install on customer machine; test P07 short + P08-P10 valid and verify only valid playlist videos are created.

## 2026-08-27 — Rebuild 4.5.2 with partial-playlist continuation


- Changed: Rebuilt Windows 4.5.2 installer/portable after short-playlist handling fix. Valid audio playlists continue to video export; materially short playlists are reported/skipped.
- Files: generated `dist-electron-output-4.5.2-r2/`, [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build` passed; installer `369436384` bytes; portable `369206259` bytes; `latest.yml` reports `4.5.2`; packed ASAR main hash matches loose bundle (`91BC71DBD57C5C129285EAC096C2B88286519705D2B0CF1F92D2BD2DF1220DCA`); packed code contains short-playlist continuation and `validPlaylists` mapping. No upload/publish.
- Warnings: existing dynamic imports, unresolved fonts, hash sentinel, duplicate dependencies, default Electron icon, and `DEP0190`. Standard output remains separate/locked.
- Follow-up: install on customer machine; test P07 short + P08-P10 valid and verify only valid playlist videos are created.

## 2026-08-27 — Continue valid playlists after short audio output

- Changed: Autopilot now skips only materially short audio outputs (<90% of rendered expected duration), logs playlist number/path/actual/expected duration and recovery steps, then continues exporting later playlists. Final video export receives only valid playlist/audio pairs and reports partial completion instead of stopping because one playlist is short.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: User wants a 60-minute playlist that accidentally outputs a few minutes to be reported and skipped, while all valid playlists continue to video export.
- Preserved: valid Crossfade drift, opening/ending tracks, returned audio paths, video ordering, cancellation, retries, duration semantics.
- Verification: duration regression test passed; esbuild syntax check passed; `npm run build` passed. Installer rebuild pending.
- Follow-up: build 4.5.3 before customer install; smoke one short playlist between valid playlists and confirm later videos are emitted.

## 2026-08-27 — Tolerate AAC duration rounding

- Changed: Autopilot accepts up to 8 seconds of rendered-audio duration difference instead of 5 seconds, avoiding false failures such as actual `1:04:03` vs expected `1:03:58` after AAC/Crossfade muxing; partial output remains blocked.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Customer saw a normal 5-second AAC/MP4 rounding difference rejected before video export.
- Verification: duration regression test passed; `npm run build` passed. No installer rebuild.

## 2026-08-27 — Package Windows 4.5.2

- Changed: Packaged Windows NSIS installer and portable EXE for 4.5.2 with rechecked video repair actions.
- Files: generated `dist-electron-output-4.5.2/`, [HANDOFF.md](HANDOFF.md).
- Verification: installer `369435796` bytes; portable `369205588` bytes; blockmap `380194` bytes; `latest.yml` reports `4.5.2`; packed main hash matches loose build (`EF8A4841B0B5BDEA3204B7913CE0943F40F1C94AB3C4CAE3CC89C6E0B2DE954C`); repair IPC and atomic backup replacement code present; bundled FFmpeg, FFprobe, yt-dlp, and AtomicParsley present. No upload/publish.
- Warnings: existing dynamic-import, unresolved-font, hash-sentinel, duplicate-dependency, default-icon, and `DEP0190` warnings. Standard output lock remains avoided via isolated output folder.
- Follow-up: install 4.5.2 and manually verify recheck → delete and recheck → replace flows on a disposable copy of source videos.

## 2026-08-27 — Build Windows 4.5.2

- Changed: Bumped desktop/package-lock and Worker fallback policy to `4.5.2`; built production Electron bundle with gated Autopilot video repair actions.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [electron/handlers/autopilotHandlers.ts](electron/handlers/autopilotHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/components/AutopilotVideoRepairActions.tsx](src/components/AutopilotVideoRepairActions.tsx), generated `dist-electron/`, [HANDOFF.md](HANDOFF.md).
- Verification: focused tests passed — 3 files, 9 selected tests; `npm run build` passed; no installer publish.
- Warnings: existing dynamic-import, unresolved-font, hash-sentinel, duplicate-dependency, default-icon, and `DEP0190` warnings remain.
- Follow-up: package Windows installer after customer validates Rà soát lại → Xóa/Chuẩn hóa & thay thế flow on Z: source.

## 2026-08-27 — Add Autopilot video repair actions

- Verification: `npx vitest run tests/unit/autopilotVideoRepair.test.ts tests/unit/backend/videoUtils.test.ts --config ./vitest.config.ts --reporter=verbose` passed (2 files, 7 tests). `npm run build` passed. No installer rebuild.
- Follow-up: install rebuilt app on customer machine; run Rà soát lại, normalize, and delete flows against real Z: input files.

## 2026-08-27 — Add Autopilot video repair actions (details)

- Changed: Invalid-video error cards now offer `Rà soát lại`, `Chuẩn hóa lại`, and confirmed `Xóa file lỗi` actions. Failed paths are grouped under configured roots; normalization writes to a separate `_autopilot_normalized` folder; deletion uses existing root-confined `video:deleteFiles`. Video audit now returns per-file reasons through IPC/types.
- Files: [src/components/AutopilotVideoRepairActions.tsx](src/components/AutopilotVideoRepairActions.tsx), [src/utils/autopilotVideoRepair.ts](src/utils/autopilotVideoRepair.ts), [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx), [electron/handlers/systemHandlers.ts](electron/handlers/systemHandlers.ts), [src/types/ipc.ts](src/types/ipc.ts), [tests/unit/autopilotVideoRepair.test.ts](tests/unit/autopilotVideoRepair.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Customer video audit and Autopilot disagreed on transient/metadata validity; users had no direct repair operation from the error card.
- Preserved: original files by default, explicit deletion confirmation, root confinement, Windows/UNC path safety, existing normalize settings, cancellation, and IPC channels.
- Verification: helper/audit tests and `npm run build` passed. Packaged installer rebuild pending.

## 2026-08-27 — Build Windows 4.5.1

- Changed: Bumped desktop/package-lock and Worker fallback policy to `4.5.1`; packaged Windows NSIS installer and portable EXE with Crossfade duration guard fix.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), generated `dist-electron-output-4.5.1/`, [HANDOFF.md](HANDOFF.md).
- Verification: focused tests passed — 3 files, 12 selected tests; `npm run build` passed; installer `369433264` bytes; portable `369203070` bytes; `latest.yml` reports `4.5.1`; extracted ASAR main hash matches loose bundle (`513EC42ABA9CCE3935122C440BA5EE02AD298239A1DC16A0DBFA265FB1CFDCE3`); Crossfade expected-render guard present. No upload/publish.
- Warnings: existing build warnings dynamic imports, unresolved fonts, hash sentinel, duplicate dependencies, default Electron icon, Node `DEP0190`. Standard `dist-electron-output/` lock remains separate.
- Follow-up: install 4.5.1 on customer machine and run Autopilot with Crossfade enabled; verify valid audio reaches video stage and short/partial audio stops with exact path and recovery.

## 2026-08-26 — Accept valid Crossfade audio before video export

- Changed: Autopilot duration guard now compares exported Crossfade audio with its rendered duration (`playlist total - overlap`) instead of raw pre-crossfade playlist duration. Short/partial audio remains blocked, while valid Crossfade playlist audio proceeds to video export.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Customer `autopilot (2).log` showed valid Crossfade P01 output around 1:06 blocked against raw 1:07 playlist duration, so Autopilot never entered video export.
- Preserved: returned-output path mapping, partial-audio block, opening/ending tracks, Crossfade duration semantics, retries, and final video duration matches actual audio.
- Verification: focused test/build pending.

## 2026-08-26 — Build Windows 4.5.0

- Changed: Bumped desktop/package-lock and Worker fallback policy to `4.5.0`; built Windows NSIS installer and portable EXE with Autopilot diagnostics and bounded Electron force-exit.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [electron/windowManager.ts](electron/windowManager.ts), [electron/main.ts](electron/main.ts), generated `dist-electron-output-4.5.0/`, [HANDOFF.md](HANDOFF.md).
- Verification: focused tests passed — 3 files, 12 tests; `npm run build` passed; installer `369433140` bytes; portable `369203010` bytes; `latest.yml` reports `4.5.0`; extracted ASAR main hash matches loose bundle (`72B804F987E2FA5FE3E9220433477FAF92E617BFFCF5BCF348665A1D77B52773`); force-exit fallback present. No upload/publish.
- Warnings: standard `dist-electron-output/` remains locked by external process; artifacts were written to isolated output. Existing build warnings: dynamic imports, unresolved fonts, hash sentinel, duplicate dependencies, default Electron icon, Node `DEP0190`.
- Follow-up: install on clean Windows; run active Autopilot/FFmpeg close test; confirm process tree exits within 8 seconds and standard output unlocks.

## 2026-08-26 — Bounded Electron force-exit

- Changed: Confirmed app exit now arms an 8-second fallback that destroys remaining windows and calls `app.exit(0)` if Electron remains stuck after cancellation begins. `will-quit` clears the fallback timer.
- Files: [electron/windowManager.ts](electron/windowManager.ts), [electron/main.ts](electron/main.ts), [HANDOFF.md](HANDOFF.md).
- Why: Clicking X could leave Electron/FFmpeg alive and keep `app.asar` locked even after forced close was requested.
- Preserved: normal exit confirmation, active-export cancellation, Windows FFmpeg process-tree cleanup, updater behavior, and data-loss warning.
- Verification: focused lifecycle test and manual active-export close test pending.

## 2026-08-26 — Always show actionable Autopilot errors in UI

- Changed: Plan Mode and Batch Mode now preserve/render full backend diagnostics instead of generic `Lỗi`, `không thành công`, or status-only text. Batch terminal errors write exact backend detail into batch card/log; Plan Mode renders multiline cause, path, stage, FFmpeg detail, and recovery steps. Runner day summaries/status retain bounded full diagnostics and avoid duplicate generic hints.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Users saw only `hỏng`/`không thành công` while exact corrupt file and repair plan existed only in backend logs.
- Preserved: cancellation short messages, detailed media paths, retries, duration semantics, and IPC contracts.
- Verification: focused UI/build verification pending.

## 2026-08-26 — Block stale/short audio from final video

- Changed: Autopilot now probes each returned audio output, logs exact path and real duration against playlist duration, refuses final video mapping when audio differs by more than 5 seconds, and uses returned output paths instead of rescanning output folders (prevents stale/partial P10 pairing).
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Customer log showed playlist audio P10 created as 60-minute target but final video P10 reported 2.9 minutes; final export trusts probed audio duration, so stale/partial audio mapping could create short video without failure.
- Preserved: playlist duration semantics, opening-track behavior, cancellation, retry, output naming, Windows paths, and final-export duration behavior.
- Verification: duration regression test passed; changed media tests passed (2 files, 10 tests). Full Autopilot file has one pre-existing localized folder-validation assertion mismatch. Build/smoke pending.

## 2026-08-25 — Build 4.4.9 requested

- Changed: Bumped app/package lock and fallback Worker policy to `4.4.9` for the media-diagnostics release.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [HANDOFF.md](HANDOFF.md).
- Why: 4.4.8 shipped a media diagnostic scope defect; 4.4.9 is required for the fixed runtime.
- Verification: `npm run build` passed; focused media tests passed (2 files, 10 tests). `npm run clean:build:win` and `npm run build:win` both failed because legacy `dist-electron-output/win-unpacked/resources/app.asar` remains locked by an external process. Previously built isolated artifacts in `dist-electron-output-4.4.9/` remain valid: installer/portable created, packed main hash matches loose build (`440163B4...`), video diagnostics present, and `playlist` is hoisted before `try`; no upload/publish.
- Follow-up: close the process holding legacy `app.asar` or reboot Windows, then rerun `npm run clean:build:win` if standard output path is required. Smoke-test corrupt audio/video inputs on clean Windows before release.

## 2026-08-25 — Autopilot actionable media diagnostics

- Changed: Audio export now keeps playlist scope available during decoder diagnosis and reports exact bad track names/paths plus FFmpeg detail and AAC recovery steps. Video source validation now returns per-path failure reasons; final export refuses silently dropped invalid inputs and attaches job stage, audio/output paths, source clips, FFmpeg tails, and recovery guidance to failed jobs. Pre-transcode failures retain source paths; strict plans fail without replacement.
- Files: [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [backend/video/videoUtils.ts](backend/video/videoUtils.ts), [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/exportAudio.test.ts](tests/unit/backend/exportAudio.test.ts), [tests/unit/backend/videoUtils.test.ts](tests/unit/backend/videoUtils.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: `playlist is not defined` masked corrupt audio; video failures could be skipped or reduced to output-only errors, leaving users without exact files or repair steps.
- Preserved: audio duration semantics, Windows/Unicode paths, cancellation, retry, temp cleanup, strict pairing, and no source deletion changes.
- Verification: focused tests/build pending. Installer rebuild and clean-machine smoke remain required before release.

## 2026-08-25 — Build 4.4.9 requested

- Changed: Bumped app/package lock and fallback Worker policy to `4.4.9` for the media-diagnostics release.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [HANDOFF.md](HANDOFF.md).
- Why: 4.4.8 shipped a media diagnostic scope defect; 4.4.9 is required for the fixed runtime.
- Verification: `npm run build` passed; focused media tests passed (2 files, 10 tests). `npm run clean:build:win` and `npm run build:win` both failed because legacy `dist-electron-output/win-unpacked/resources/app.asar` remains locked by an external process. Previously built isolated artifacts in `dist-electron-output-4.4.9/` remain valid: installer/portable created, packed main hash matches loose build (`440163B4...`), video diagnostics present, and `playlist` is hoisted before `try`; no upload/publish.
- Follow-up: close the process holding legacy `app.asar` or reboot Windows, then rerun `npm run clean:build:win` if standard output path is required. Smoke-test corrupt audio/video inputs on clean Windows before release.

## 2026-08-25 — Autopilot actionable media diagnostics

- Changed: Audio export now keeps playlist scope available during decoder diagnosis and reports exact bad track names/paths plus FFmpeg detail and AAC recovery steps. Video source validation now returns per-path failure reasons; final export refuses silently dropped invalid inputs and attaches job stage, audio/output paths, source clips, FFmpeg tails, and recovery guidance to failed jobs. Pre-transcode failures retain source paths; strict plans fail without replacement.
- Files: [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [backend/video/videoUtils.ts](backend/video/videoUtils.ts), [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/exportAudio.test.ts](tests/unit/backend/exportAudio.test.ts), [tests/unit/backend/videoUtils.test.ts](tests/unit/backend/videoUtils.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: `playlist is not defined` masked corrupt audio; video failures could be skipped or reduced to output-only errors, leaving users without exact files or repair steps.
- Preserved: audio duration semantics, Windows/Unicode paths, cancellation, retry, temp cleanup, strict pairing, and no source deletion changes.
- Verification: focused tests/build pending. Installer rebuild and clean-machine smoke remain required before release.

## 2026-08-21 — Build Windows 4.4.8 artifacts

- Changed: Bumped desktop app and fallback policy version from `4.4.7` to `4.4.8`; built NSIS installer, portable EXE, blockmap, and updater metadata. No upload/publish/commit.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), generated files under `dist-electron-output/`, [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build:win` passed; `dist-electron-output/latest.yml` reports `4.4.8`; installer `369431135` bytes; blockmap `380190` bytes; portable `369201003` bytes. Existing warnings: dynamic imports, unresolved fonts, hash sentinel, duplicate dependency references, default Electron icon, Node `DEP0190`.
- Follow-up: install/test 4.4.8 on clean Windows machine; upload artifacts separately when release publishing is explicitly approved.

## 2026-08-21 — Open last genre output after queue

- Changed: Successful multi-genre queue export now records the last processed genre folder, restoring `Mở thư mục đã xuất` after queue completion.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Queue flow exported files but never set `lastOutputDir`, so no open-folder action appeared.
- Verification: `npm run build` passed; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: run two-genre queue; after success click `Mở thư mục đã xuất` and verify it opens the final genre folder.

- Changed: Successful multi-genre queue export now records the last processed genre folder, restoring `Mở thư mục đã xuất` after queue completion.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Queue flow exported files but never set `lastOutputDir`, so no open-folder action appeared.
- Verification: `npm run build` passed; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: run two-genre queue; after success click `Mở thư mục đã xuất` and verify it opens the final genre folder.

## 2026-08-21 — Restore ETA for genre export queue

- Changed: `runExportQueue()` now initializes per-playlist progress, playlist start time, speed/ETA state, and completion progress, then clears those states after queue completion.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Multi-genre queue exports ran without the progress/ETA state used by the normal export path.
- Preserved: existing export IPC, FFmpeg behavior, duration semantics, genre output routing, retry, cancellation, and history.
- Verification: `npm run build` passed; focused export tests passed — 2 files, 13 tests; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: manual run two-genre queue; confirm progress bar, speed, ETA, completion reset, and cancel.

## 2026-08-21 — Fix per-genre export render scope

- Changed: Fixed `selectedPlaylistsForExport` render-time ReferenceError by defining selected playlist list before `invalidConfig`; build now loads Export tab again.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build` passed. Existing build warnings remain dynamic imports, unresolved fonts, and hash sentinel.

- Changed: Fixed `selectedPlaylistsForExport` render-time ReferenceError by defining selected playlist list before `invalidConfig`; build now loads Export tab again.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build` passed. Existing build warnings remain dynamic imports, unresolved fonts, and hash sentinel.

## 2026-08-21 — Per-genre export folders and Step 2 settings authority

- Changed: Step 4 now requests one output folder per genre and routes each playlist to its genre folder. Global crossfade/loudnorm controls were removed; export uses `genreSettings` saved in Step 2 as sole source of truth.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Global Step 4 settings could conflict with per-genre Step 2 settings, and one shared output folder mixed exports from multiple genres.
- Preserved: existing export IPC request shape, audio duration semantics, playlist selection, queue/progress, retry, cancellation, history, and Windows path handling.
- Verification: `npm run build` passed; focused audio export/scan tests passed — 2 files, 13 tests; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: manual two-genre export with separate folders and different Step 2 crossfade/loudnorm settings.

## 2026-08-21 — Add save settings and recreate-all genre actions

- Changed: Step 4 now requests one output folder per genre and routes each playlist to its genre folder. Global crossfade/loudnorm controls were removed; export uses `genreSettings` saved in Step 2 as sole source of truth.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Global Step 4 settings could conflict with per-genre Step 2 settings, and one shared output folder mixed exports from multiple genres.
- Preserved: existing export IPC request shape, audio duration semantics, playlist selection, queue/progress, retry, cancellation, history, and Windows path handling.
- Verification: pending `npm run build`, focused export checks, and `git diff --check`.
- Follow-up: manual two-genre export with separate folders and different Step 2 crossfade/loudnorm settings.

## 2026-08-21 — Add save settings and recreate-all genre actions

- Changed: Step 2 now has top-right `Lưu cài đặt` with timestamp feedback and `Tạo lại toàn bộ thể loại`, which sequentially reruns existing per-genre playlist creation using saved count/duration/priority, pinned/ending tracks, crossfade, and loudnorm settings.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Multi-genre users had to recreate genres one by one and re-enter settings intent manually.
- Preserved: existing localStorage key/data shape, per-genre controls, IPC payloads, playlist order, audio duration semantics, Preview/Export data flow.
- Verification: `npm run build` passed; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: manual edit/save/reload two genre configs, then run recreate-all and verify sequential card updates and export order.

## 2026-08-21 — Collapse generated playlist tables by default

- Changed: Step 2 generated playlist result tables now start collapsed; users click a playlist header to view its track table.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Auto-expanded tables made the multi-genre creation screen too long immediately after generating playlists.
- Preserved: full table columns and playlist summaries, create/recreate, per-genre configuration, localStorage, IPC, Preview/Export data.
- Verification: not run; one-attribute renderer-only change.
- Follow-up: click create/recreate for two genres; confirm all generated playlists start collapsed and expand independently.

## 2026-08-21 — Bulk-select dates and scale export history UI

- Changed: Export history modal now has `Chọn tất cả ngày` / `Bỏ chọn tất cả ngày`, synchronizing date and entry selections for existing delete/download actions. Modal is wider and bounded; date sidebar and genre-grouped history content scroll independently for many dates/genres.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Deleting many export days required repeated clicks, and a narrow fixed modal became hard to scan after multi-genre export.
- Preserved: history IPC/data, per-date/entry selection, genre grouping, claim lookup, download, delete, export lifecycle, cancellation, retry, and audio duration behavior.
- Verification: `npm run build` passed; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: Manual smoke with many dates and multiple genres; verify select-all dates, delete/download, independent scrolling, selection reset on close.

## 2026-08-21 — Group export history by genre

- Changed: Export history now groups selected-day playlist entries by current playlist genre, showing genre playlist/selection counts and compact output filenames; legacy or recreated entries fall under `Playlist cũ / không rõ thể loại`. Selected tracklist shows playlist and genre context.
- Files: [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: A flat date list mixed exports from several genres, making multi-genre history hard to scan.
- Preserved: history IPC/data, date and entry selection, claim lookup, download, delete, export lifecycle, cancellation, retry, and audio duration behavior.
- Verification: `npm run build` passed after one JSX typo repair; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: Manual history smoke with two genres exported same date; verify grouping, selection, claim lookup, date select-all, download, delete, and legacy fallback after recreate/delete.

## 2026-08-21 — Keep auto-normalized AAC outside scan roots

- Changed: Automatic non-AAC fill now computes `aac_chuanhoa` outside configured priority/random/opening scan folders, using a Windows-path common ancestor and rejecting unsafe inside-root candidates. UI explains output stays outside scan folders to avoid duplicate scan results.
- Files: [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Previous default `<source>\\aac_chuanhoa` lived inside a scanned folder, so the next scan could include both original and normalized copies.
- Preserved: Original source files, manual output-folder override, AAC format, backup option, FFmpeg collision guards, progress, cancellation, IPC contract, Unicode/space path handling.
- Verification: `npm run build` passed; focused scan tests passed — 2 files, 9 tests; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: Manual smoke with configured folders containing spaces/Unicode and multiple roots; click auto-fill, verify displayed output is outside every scan root, normalize, then rescan.

## 2026-08-21 — Stack genre cards vertically

- Changed: Step 2 genre workspace now uses one full-width column instead of responsive two-column cards, so multiple genres read top-to-bottom without horizontal card scrolling.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Side-by-side genre cards narrowed full playlist tables and forced horizontal scrolling; vertical stacking matches old UI readability.
- Preserved: genre card controls, full playlist result tables, per-genre create/recreate, localStorage workspace, IPC payloads, Preview/Export data and ordering.
- Verification: `npm run build` passed; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: Manual smoke with 2+ genres; confirm page scrolls down and tables no longer need horizontal scrolling for normal filenames.

## 2026-08-21 — Restore full playlist result tables in genre cards

- Changed: Step 2 generated playlists now show old-style full result tables inside each genre card with columns `#`, `Tên bài`, `Loại`, `Thời lượng`, and `Tích lũy`; playlist headers show duration, main/ending split, track count, priority, and random ratios. Pinned labels use that genre's configuration.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Compact one-line summaries hid track-level playlist details after multi-genre creation; user requested parity with old UI table.
- Preserved: per-genre create/recreate, localStorage workspace, IPC payloads, Preview/Export playlist data and ordering.
- Verification: `npm run build` passed; focused Vitest passed — 3 files, 10 tests; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: Manual Electron smoke Step 2 with two genres; confirm full tables, recreate isolation, Preview grouping, and Export queue.

## 2026-08-22 — Replace regenerated genre playlists

- Changed: Step 2 generated playlists now show old-style full result tables inside each genre card with columns `#`, `Tên bài`, `Loại`, `Thời lượng`, and `Tích lũy`; playlist headers show duration, main/ending split, track count, priority, and random ratios. Pinned labels use that genre's configuration.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Compact one-line summaries hid track-level playlist details after multi-genre creation; user requested parity with old UI table.
- Preserved: per-genre create/recreate, localStorage workspace, IPC payloads, Preview/Export playlist data and ordering.
- Verification: `npm run build` passed; focused Vitest passed — 3 files, 10 tests; `git diff --check` passed with existing CRLF warnings. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: Manual Electron smoke Step 2 with two genres; confirm full tables, recreate isolation, Preview grouping, and Export queue.

## 2026-08-22 — Replace regenerated genre playlists

- Changed: Recreating genre playlist card now removes old persisted playlists for same `genreId` before saving new ones; other genre playlists remain. Tabs 3–4 no longer show stale copies after regeneration.
- Files: [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [HANDOFF.md](HANDOFF.md).
- Verification: `npm run build` passed; `git diff --check` passed.

## 2026-08-22 — Multi-genre UI layout refinement

- Changed: Main Create Playlist view now prioritizes genre workspace cards; legacy single-genre form is collapsed under `Chế độ cũ`. Cards show per-genre settings, create/recreate, ready playlist preview, and error status. Export view adds `Chạy tất cả theo thể loại`, per-genre export, retry-failed playlist button, grouped headers, and per-playlist status.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [src/pages/Music/PreviewPlaylistPage.tsx](src/pages/Music/PreviewPlaylistPage.tsx), [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Previous UI mixed genre cards into track list while legacy global config remained dominant and hid multi-genre workflow.
- Verification: `npm run build` passed; `git diff --check` passed. Dev app restarted for manual UI test.
- Follow-up: User should scan two genres, create each card, test Preview genre grouping, then run Export queue; report UI adjustments.

## 2026-08-22 — Multi-genre playlist workspace vertical slice

- Runtime smoke: `npm run dev` launched Electron + renderer at `http://localhost:5173/`; FFmpeg/FFprobe resolved from `bin/`, IPC handlers registered, app window initialized. Queue self-check passed with `a:a1 | a:a2 | b:b1`.
- Verification: `npm run build` passed; `git diff --check` passed. Vitest collection remains blocked by existing `Cannot read properties of undefined (reading 'config')` setup failure.

## 2026-08-22 — Multi-genre playlist workspace vertical slice (details)

- Changed: Create Playlist now shows each scanned genre as an isolated card with per-genre playlist count/duration/priority settings and create/recreate action. Generated playlists carry `genreId`/`genreName`, append to persisted playlist store, and workspace state persists in localStorage. Preview and Export playlist lists now show genre boundaries; added pure sequential queue helper for next Tabs 3–4 queue work.
- Files: [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [src/pages/Music/PreviewPlaylistPage.tsx](src/pages/Music/PreviewPlaylistPage.tsx), [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [backend/music/playlistEngine.ts](backend/music/playlistEngine.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/features/musicGenreQueue.ts](src/features/musicGenreQueue.ts), [tests/unit/musicGenreQueue.test.ts](tests/unit/musicGenreQueue.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Tabs 1–4 only operated one selected genre at a time; changing dropdown reset generated playlists and prevented sequential multi-genre flow.
- Preserved: existing single-genre configuration/create flow, IPC `music:createPlaylists`, playlist engine duration/reuse rules, persisted playlists, scan result source.
- Verification: `npm run build` passed; `git diff --check` passed. Multi-genre queue self-check passed via `npx tsx`; focused Vitest is blocked by existing setup error `Cannot read properties of undefined (reading 'config')`; no test collection.
- Follow-up: complete true Tab 4 queue grouping/run-genre/retry/cancel; current per-genre creation and genre headers are vertical-slice behavior for user testing.

## 2026-08-22 — Structured operation logs for runtime diagnosis

- Changed: Added bounded structured operation log helper with scope, operation, status, request/batch IDs, step, safe metadata, and path hashing. Autopilot final-export planning now logs runtime policy (`uniqueRequired`, `requireUniqueSequences`, retained sequence count, output count) to expose stale-bundle/policy mismatches.
- Files: [backend/utils/operationLog.ts](backend/utils/operationLog.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [tests/unit/backend/operationLog.test.ts](tests/unit/backend/operationLog.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Runtime logs did not prove which policy path executed, making reuse/unique errors hard to diagnose.
- Preserved: existing human-readable logs, no secrets, bounded metadata, media duration/cancel behavior, no IPC changes.
- Verification: pending focused operation-log tests, build, and diff check.
- Follow-up: instrument remaining operation boundaries (scan, normalize, final export, shutdown) incrementally without per-frame log spam.

## 2026-08-22 — Batch Mode missing-source repair and retry

- Changed: Missing FFmpeg input paths now appear in Vietnamese export errors. Autopilot does not retry a playlist when its source is missing; Batch Mode shows `Sửa nhanh: quét lại & chạy lại`, which rebuilds playlists from currently configured folders before retrying one batch.
- Files: [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx), [tests/unit/backend/exportAudio.test.ts](tests/unit/backend/exportAudio.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Live batch used stale persisted playlist paths not present in current folder settings; retrying identical paths wasted time and hid direct repair path.
- Preserved: fresh Batch scan/build behavior, configured folders/output paths, source-file safety, cancellation, media duration semantics, unrelated batch state.
- Verification: `npx vitest run tests/unit/backend/exportAudio.test.ts --config ./vitest.config.ts --reporter=verbose` passed (6 tests); `npm run build` passed; `git diff --check` passed. Existing warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: ensure missing source is restored or configure correct music folder before clicking Sửa nhanh; button cannot reconstruct deleted or disconnected files.

## 2026-08-22 — Electron close and FFmpeg process-tree shutdown

- Changed: Window close now uses a guarded exit confirmation; shutdown no longer awaits async cancellation in `before-quit`; Windows FFmpeg cancellation invokes `taskkill /T /F` for the full process tree with direct kill fallback. Unresponsive-window close uses same exit path. SIGTERM/SIGINT and bounded `will-quit` fallback added for dev process shutdown.
- Files: [backend/video/videoJobManager.ts](backend/video/videoJobManager.ts), [electron/windowManager.ts](electron/windowManager.ts), [electron/main.ts](electron/main.ts), [HANDOFF.md](HANDOFF.md).
- Why: X could appear stuck during active FFmpeg jobs and child processes could survive direct `ChildProcess.kill()`, preventing clean dev shutdown.
- Preserved: active-export warning, cancellation, packaged Windows path behavior, no renderer IPC changes.
- Verification: `npm run build` passed; `git diff --check` passed. Manual active-export close test remains pending. Existing warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: run export, click X, choose `Dừng export và thoát`; verify Electron and FFmpeg child tree exit.

## 2026-08-22 — Autopilot stops when audio export returns failure

- Changed: Autopilot now checks `exportPlaylistToFile()` result before logging success or continuing. `success: false` with Vietnamese codec/decoder/disk/path guidance now enters existing retry/fatal handling instead of being treated as success and failing later on missing output.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [HANDOFF.md](HANDOFF.md).
- Why: Playlist export could return failure while runner unconditionally logged success; retry then reported only `output file not found` and hid root cause.
- Preserved: two-attempt retry, cancellation, fatal error classification, output existence check, audio duration semantics, existing Vietnamese recovery details.
- Verification: `npm run build` passed; `git diff --check` passed. Existing warnings remain dynamic imports, unresolved fonts, and hash sentinel. Live log reproduced original bug before fix; rerun needed to confirm new propagation.
- Follow-up: rerun 20-playlist crossfade batch; failed playlist should show original decoder/file diagnosis immediately and retry only when classified retryable.

## 2026-08-06 — Persist Scan Music folder configuration

- Changed: Scan Music now keeps editable multi-genre priority/random/opening folder configuration in renderer localStorage, independent from scan-result cache. Added visible `Lưu cấu hình` button and saved timestamp; opening the app no longer replaces saved folders with stale scan-result config.
- Files: [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Folder paths disappeared after restart, forcing re-entry despite scan cache persistence.
- Preserved: scan-result cache, multi-genre/opening folders, explicit re-scan behavior, backend scan config, existing local-only persistence model.
- Verification: `npm run build` passed; `git diff --check` passed. Existing build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: restart app; enter folders, click Lưu cấu hình, reopen app, then confirm paths remain before scanning.

## 2026-08-06 — Corrupt audio track diagnosis after decoder failure
♀♀♀assistant to=functions.Read  天天中彩票腾讯analysis  彩神争霸安卓াড়출장샵{

- Changed: Decoder failures such as `scalefactor bands` and `Invalid data found when processing input` now trigger per-track FFmpeg null-decode diagnosis. User error lists suspected file names and gives Vietnamese recovery steps through Quét nhạc → Chuẩn hóa audio → AAC in a separate folder.
- Files: [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [tests/unit/backend/exportAudio.test.ts](tests/unit/backend/exportAudio.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Playlist concat previously exposed only generic FFmpeg English stderr, leaving users unable to identify which source file was corrupt.
- Preserved: codec-aware AAC selection, duration semantics, cancellation/request IDs, Windows/Unicode paths, temp cleanup, MP3/WAV/crossfade behavior, IPC compatibility.
- Verification: `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings. Focused Vitest remains blocked before collection by existing setup error `Cannot read properties of undefined (reading 'config')`; source-level tests added for classifier/message.
- Follow-up: Re-run focused tests when Vitest setup recovers; manually retry failed playlist and confirm exact bad file list.

## 2026-08-06 — Codec-aware audio export and Vietnamese recovery guidance

- Changed: AAC/M4A playlist export now probes actual audio codecs before stream-copy; Opus/Vorbis/unknown codecs are re-encoded to AAC instead of copied into an incompatible M4A container. Scan diagnostics now flag non-AAC by codec, not filename extension. Export errors include Vietnamese cause, remedy, and technical detail; Opus errors point to Normalize Audio → AAC in a separate output folder.
- Files: [backend/music/exportAudio.ts](backend/music/exportAudio.ts), [backend/music/scanMusic.ts](backend/music/scanMusic.ts), [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [tests/unit/backend/exportAudio.test.ts](tests/unit/backend/exportAudio.test.ts), [tests/unit/backend/scanMusic.test.ts](tests/unit/backend/scanMusic.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: `.m4a` files can contain Opus; extension-only detection selected `-c copy`, causing FFmpeg `Could not find tag for codec opus` and raw English errors with no user recovery path.
- Preserved: audio duration semantics, MP3/WAV/crossfade paths, Windows/Unicode paths, cancellation, temp cleanup, IPC compatibility, Normalize Audio overwrite guards.
- Verification: `npx vitest run tests/unit/backend/exportAudio.test.ts tests/unit/backend/scanMusic.test.ts --config ./vitest.config.ts --reporter=verbose` passed (2 files, 10 tests). `npm run build` passed; `git diff --check` passed. Build warnings remain dynamic imports, unresolved fonts, and hash sentinel.
- Follow-up: manual export one AAC-only, one Opus-in-M4A, and mixed-codec playlist; confirm Opus auto-re-encodes and UI explains Normalize Audio recovery.

## 2026-08-06 — Build Windows 4.4.7 for external install

- Changed: Bumped desktop app and fallback policy version from `4.4.6` to `4.4.7` for a Windows NSIS installer and portable EXE. No upload or publish.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [HANDOFF.md](HANDOFF.md), generated files under `dist-electron-output/`.
- Why: Install sequence-fingerprint/autopilot fixes on another machine.
- Preserved: updater manual-install guard, active-export protection, bundled FFmpeg/FFprobe/yt-dlp/license resources, unrelated dirty worktree changes.
- Verification: `npm run build:win` passed. Created NSIS `dist-electron-output/93-media-tool-mix-nhac-setup-4.4.7.exe` (369004225 bytes), blockmap (380023 bytes), and portable `dist-electron-output/93-media-tool-mix-nhac-4.4.7-portable.exe` (368774096 bytes). `latest.yml` reports `4.4.7`; bundled ffmpeg/ffprobe/ffplay/yt-dlp/AtomicParsley/license public key present. Build warnings remain dynamic imports, unresolved fonts, duplicate dependencies, default icon, Node DEP0190, and hash sentinel.
- Follow-up: install locally on clean machine; do not publish artifacts from this session.

## 2026-08-05 — Autopilot output sequence fingerprint guarantee

- Changed: Autopilot now plans each output against retained Video Pool full ordered physical clip fingerprints before FFmpeg; successful outputs emit canonical clip IDs and history stores one fingerprint per output. Clip reuse remains allowed; sequence exhaustion fails instead of falling back to a duplicate.
- Files: [backend/autopilot/videoPool.ts](backend/autopilot/videoPool.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/video/utils/videoPlaylistPlan.ts](backend/video/utils/videoPlaylistPlan.ts), [tests/unit/backend/videoPlaylistPlan.test.ts](tests/unit/backend/videoPlaylistPlan.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Random reseeding reduced collisions but did not guarantee distinct full sequences across sessions.
- Preserved: individual clip reuse, no-adjacent-repeat behavior, manual Tab 6 strict pairing, audio duration semantics, FFmpeg/cancel/path safety.
- Verification: planner Vitest passed before final review fixes; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed. Autopilot runner test has one pre-existing localized assertion mismatch; `npx tsc --noEmit` remains blocked by repo-wide TS6305 stale declaration outputs. Specialist review fixed manual pairing/strict-plan guard and flagged legacy prefix history plus storage-write failure; new code excludes legacy fingerprints from uniqueness claims and fails history verification after write. Final rerun pending temporary command classifier recovery.
- Follow-up: smoke repeated Autopilot runs with limited pool; verify second run rejects every retained sequence and one-clip pool reports sequence exhaustion before FFmpeg. Manual files-mode audio/video order now preserves caller order; folder audio remains sorted.

## 2026-08-05 — Autopilot cho phép reuse video giữa outputs

- Changed: Autopilot final export không còn gửi `uniqueRequired: true`; footage được tái sử dụng giữa các output khi kho video ngắn hơn tổng audio. Video sequence vẫn xoay pool theo job và `buildPlaylistToFillDuration()` tránh lặp cùng clip liền nhau khi có từ 2 clip.
- Files: [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [backend/video/utils/videoShuffleHelpers.ts](backend/video/utils/videoShuffleHelpers.ts), [tests/unit/backend/videoPlaylistPlan.test.ts](tests/unit/backend/videoPlaylistPlan.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Autopilot bị fail sau khi xuất audio vì planner ép unique toàn bộ 10 output, dù yêu cầu đúng là chỉ tránh clip trùng liền nhau và tránh sequence output giống nhau.
- Preserved: Audio/opening duration semantics, priority video ordering, Video Pool LRU/history, FFmpeg pipeline, cancel/status flow, manual Tab 6 strict pairing, packaged path safety.
- Verification: Added planner regression for cross-output reuse/distinct fingerprints. `git diff --check` pending; focused test/build pending.
- Follow-up: Run focused planner test/build; smoke original 10×30-minute case and inspect adjacent clip IDs/sequence variation.

## 2026-08-05 — Dev Electron không còn bị kẹt auth cũ

- Changed: Thêm auth bypass chỉ cho Electron chưa đóng gói với `ELECTRON_RENDERER_URL` local (`localhost`/`127.0.0.1`), trả synthetic `allowed/dev-local` không lưu password/token. Packaged build không bypass; stored `blocked` vẫn giữ block. `auth:validateToken` nhận synthetic dev state để renderer vào app.
- Files: [electron/authState.ts](electron/authState.ts), [electron/handlers/authHandlers.ts](electron/handlers/authHandlers.ts), [tests/e2e/auth.e2e.ts](tests/e2e/auth.e2e.ts), [HANDOFF.md](HANDOFF.md).
- Why: Máy dev có auth footprint cũ nhưng credential không còn, nên app hiện `Đăng nhập lại` dù chạy local dev.
- Preserved: Production/package auth fail-closed, blocked/pending/revoked/expired behavior, server auth/JWT, no credential persistence, IPC shape.
- Verification: Added dev-vs-packaged regression cases. `git diff --check` pass (CRLF warnings only). Focused auth test/build chưa chạy vì harness command classifier tạm unavailable.
- Follow-up: Restart dev server/Electron; run focused auth tests + `npm run build`; confirm packaged build still shows auth screen when no valid credential.

## 2026-08-05 — Fix JSX parser crash sau thêm folder opening

- Changed: Cô lập block JSX hỏng ở row `Nhạc nối cuối` trong [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), giữ nguyên row opening và ending audio.
- Why: Vite/Babel báo `Unexpected token (1408:46)` khiến Autopilot page không render.
- Verification: Đã sửa đúng vùng báo lỗi; build chưa chạy vì harness chặn command với `codex[1m is temporarily unavailable`.
- Follow-up: Reload Vite dev server; nếu còn lỗi, chạy `npm run build`.

## 2026-08-05 — Autopilot opening folder và luồng playlist tự động

- Changed: Thêm `openingMusicFolder` tùy chọn cho Plan Mode và từng thể loại Batch Mode; cấu hình cũ vẫn load được. Autopilot validate folder này, quét qua chung `scanMusicFolders()` với priority/random, rồi truyền `openingTracks` vào chung `playlistEngine` để xoay vòng một bài opening đầu mỗi playlist mà không trừ target nhạc chính.
- Files: [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [src/types/ipc.ts](src/types/ipc.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Autopilot phải tự động hóa đúng luồng quét nhạc → tạo playlist → xuất audio → xuất video, kế thừa scanner/playlist engine đang dùng thay vì tạo logic opening riêng hoặc bắt người dùng làm thủ công.
- Preserved: Priority/random/pinned/ending ordering, opening rotation và duration semantics của `playlistEngine`, validation Windows path, health check, progress/log, cancel, Video Pool, IPC `selectFolder` hiện có. Opening không bắt buộc; folder opening rỗng chỉ warning và tiếp tục, path được chọn nhưng mất/không tồn tại fail sớm với lỗi rõ.
- Verification: `git diff --check` pass (chỉ warning CRLF working tree). Focused Vitest và `npm run build` bị harness chặn: `codex[1m] is temporarily unavailable, so auto mode cannot determine the safety of Bash right now`; chưa có kết quả test/build mới.
- Follow-up: Khi command harness hoạt động, chạy focused Autopilot/music tests và `npm run build`; smoke Plan + Batch với 2 file opening, xác nhận config save/reload, opening xoay vòng đầu playlist, target body không đổi, missing path báo lỗi sớm.

## 2026-08-05 — Build Windows 4.4.6 và cache scan compatibility

- Changed: Bumped app/policy version to `4.4.6`; rebuilt NSIS installer and portable EXE. Scan Music hydration normalizes legacy genre cache entries missing folder arrays, preventing packaged crash `Cannot read properties of undefined (reading 'join')`.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [dist-electron-output/latest.yml](dist-electron-output/latest.yml), installer, portable EXE, and [HANDOFF.md](HANDOFF.md).
- Why: New machines with old/incomplete scan cache could not open Quét nhạc; release needed installable `4.4.6` artifacts.
- Preserved: Existing dirty files and unrelated features; no publish/upload.
- Verification: Focused scan/opening tests passed earlier. Full Vitest: 24 files passed, 5 files failed, 186 passed, 8 failed, 2 skipped. Failures include pre-existing Electron mock `protocol`, Autopilot localized assertion, extract-audio timeout, output-verification mocks, and YouTube parser ordering. `npm run build:win` passed. `latest.yml` reports `4.4.6`; `git diff --check` passed. Build warnings remain dynamic imports, unresolved fonts, duplicate dependencies, default icon, Node DEP0190, and hash sentinel.
- Follow-up: Run packaged smoke on clean machine: open Quét nhạc with no cache, old/incomplete cache, missing folders; verify folder config restoration and opening summary. Fix unrelated full-suite failures before claiming all tests green.

## 2026-08-05 — Chuyển Spotify metadata sang YouTube Downloader

- Changed: Moved Spotify metadata import UI/state from Quét nhạc to YouTube Downloader. Scan result summary now shows `Mở đầu` count and total duration; existing per-genre rows remain unchanged.
- Files: [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [HANDOFF.md](HANDOFF.md).
- Why: Spotify metadata belongs with download/import tools, not local music scanning; opening library count must be visible after scan.
- Preserved: Routes/sidebar numbering, Spotify `music.spotifyImport` IPC, no Spotify audio download, YouTube download/cookie/queue behavior, scan settings and cached results.
- Verification: Focused music tests passed — 4 files, 10 tests. `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings. `git diff --check` passed.
- Follow-up: Reload running dev app, confirm Spotify metadata appears only in YouTube Downloader and scan summary displays opening count/duration.

## 2026-08-05 — Thêm kho nhạc mở đầu theo thể loại

- Changed: Quét nhạc nhận `openingFolders` riêng từng thể loại, quét/cache file opening với `folderType: 'opening'`; Tạo playlist xoay vòng một bài opening lên đầu mỗi playlist, không trừ thời lượng opening khỏi target nhạc chính.
- Files: [backend/music/scanMusic.ts](backend/music/scanMusic.ts), [backend/music/scanStore.ts](backend/music/scanStore.ts), [backend/music/playlistEngine.ts](backend/music/playlistEngine.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [tests/unit/backend/playlistEngineOpening.test.ts](tests/unit/backend/playlistEngineOpening.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Cho phép mỗi thể loại có kho nhạc mở đầu riêng; playlist 1..N lấy opening tuần tự và quay vòng khi thiếu bài.
- Preserved: Priority/random/pinned/ending ordering, deterministic playlist rotations, LRU pool chỉ dùng nhạc chính, legacy scan folders, audio export duration semantics ngoài opening target behavior.
- Verification: Focused Vitest passes on 2026-08-05 with default pool — 4 files, 10 tests. `git diff --check` passes. The earlier failure only occurs with explicit `--pool=forks`; this Vitest 4.1.2 setup works with default pool/threads. Build and manual smoke remain pending.
- Follow-up: Use default pool or `--pool=threads`; run build, IPC integration QA, then manual smoke with two genres/opening rotation.

## 2026-07-31 — Spotify metadata-only playlist import

- Changed: Added strict Spotify track/album/playlist URL and URI parsing, main-process Web API metadata resolution with ordered pagination, bounded timeout/rate-limit handling, typed IPC, and Scan Music metadata importer UI.
- Files: [backend/music/spotifyMeta.ts](backend/music/spotifyMeta.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [tests/unit/backend/spotifyMeta.test.ts](tests/unit/backend/spotifyMeta.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Accept Spotify playlist links without attempting prohibited Spotify audio ripping; expose ordered metadata and Spotify attribution only.
- Preserved: Existing oEmbed `music:spotifyMeta`, local scan/playlist/export behavior, audio duration semantics, yt-dlp/downloader, FFmpeg, auth, and renderer isolation. No Spotify audio URL, preview URL, token, or secret crosses IPC.
- Verification: `git diff --check` passed; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings. Focused Vitest remained blocked by existing setup error `Cannot read properties of undefined (reading 'config')`; `npx tsc --noEmit --pretty false` remained blocked by existing TS6305 stale declaration errors. No live Spotify request.
- Follow-up: Configure a main-process/server Spotify access-token boundary; run IPC integration QA and manual Electron smoke for public playlist, 50+ items, unavailable/local entries, and missing-token error.

## 2026-07-30 — Show per-file extraction failures

- Changed: Batch audio extraction result now includes each failed input path, file name, and readable reason. Extract Audio tab renders the exact failed files instead of only aggregate count/last error.
- Files: [backend/video/extractAudio.ts](backend/video/extractAudio.ts), [electron/handlers/videoHandlers.ts](electron/handlers/videoHandlers.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/pages/Video/ExtractAudioTab.tsx](src/pages/Video/ExtractAudioTab.tsx), [tests/unit/backend/extractAudio.test.ts](tests/unit/backend/extractAudio.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Manual smoke showed 48 inputs, 42 outputs, and 6 failures, but UI exposed only `Video không có luồng âm thanh` without names.
- Preserved: Successful outputs, MP3/WAV commands, collision-safe naming, temp cleanup, cancellation, and existing IPC channel.
- Verification: Focused Vitest/build unavailable because harness reported `codex[1m] safety-classifier unavailable`; `git diff --check` pending.
- Follow-up: Restart dev app and rerun 48-file batch; inspect six named failures.

## 2026-07-30 — Add local batch video-to-audio extraction

- Changed: Added local multi-video audio extraction in Video tools with MP3/WAV output, Unicode/space-safe paths, collision-safe names, temporary-file cleanup, per-file progress, partial-failure reporting, and cancel support. Added typed IPC handler/preload bridge and `Tách âm thanh` tab.
- Files: [backend/video/extractAudio.ts](backend/video/extractAudio.ts), [electron/handlers/videoHandlers.ts](electron/handlers/videoHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [src/pages/Video/ExtractAudioTab.tsx](src/pages/Video/ExtractAudioTab.tsx), [src/pages/Video/CutMergeVideoPage.tsx](src/pages/Video/CutMergeVideoPage.tsx), [tests/unit/backend/extractAudio.test.ts](tests/unit/backend/extractAudio.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: User requested extracting audio from multiple local video files without requiring remote yt-dlp URLs.
- Preserved: Existing mute/normalize/export/YouTube behavior, source files, output-root selection, original duration, packaged FFmpeg lookup, and cancellation through `video:cancelJob`.
- Verification: `git diff --check` passed. Focused test and build commands were blocked by temporary `codex[1m] safety-classifier unavailable`; manual Electron smoke remains required.
- Follow-up: Run focused Vitest/build when harness command execution recovers; smoke test two Unicode/space-path videos in MP3 and WAV, duplicate basenames, silent input, partial failure, and cancellation.

## 2026-07-30 — Separate TikTok extractor retry from verified audio output

- Changed: Direct TikTok downloads and metadata lookup now omit YouTube-only referer/player-client arguments, use TikTok referer, and retry once only for TikTok webpage/rehydration extractor errors. Direct and sequential batch audio now verify non-empty output paths from stdout/stderr and use fresh recursive MP3/WAV fallback for Unicode or nested creator folders. Sequential batches also pass bundled FFmpeg location. yt-dlp final-path markers now win over intermediate media destinations.
- Files: [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts), [tests/unit/backend/youtubeDownloader.test.ts](tests/unit/backend/youtubeDownloader.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Logs showed two separate faults: yt-dlp TikTok webpage extraction failed upstream, while a successful TikTok MP3 was written under a nested Unicode path but app reported missing output.
- Preserved: Existing URL routing, selected output root, file-containment/non-empty validation, audio formats, cookies, resume support, cancellation, progress, non-TikTok YouTube arguments, and bounded retry scope.
- Verification: Focused Vitest was blocked by temporary `codex[1m] safety-classifier unavailable`; earlier run passed 1 file, 7 tests. `git diff --check` passed after final-path additions.
- Follow-up: Restart dev Electron and retry direct TikTok MP3/WAV. `Unexpected response from webpage request` can remain an upstream TikTok/yt-dlp failure after one retry; update bundled yt-dlp for release when upstream fixes land.

## 2026-07-30 — Force yt-dlp to bundled FFmpeg for TikTok audio

- Changed: `downloadVideo()` now passes `--ffmpeg-location` using shared `getFfmpegPaths()` so yt-dlp audio postprocessing uses bundled ffmpeg/ffprobe instead of PATH. This fixes WAV files being created but reported missing, and ffprobe codec lookup failures in dev/package paths.
- Files: [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts), [HANDOFF.md](HANDOFF.md).
- Why: Dev log showed `[ExtractAudio] Destination` followed by `Download completed but output file was not found`; another item failed `unable to obtain file audio codec with ffprobe`. Files were present and non-empty under user output folder.
- Preserved: Queue MP3/WAV settings, direct TikTok fallback, output validation, cancellation, progress, cookies, non-TikTok download behavior.
- Verification: `git diff --check` passed. Focused tests/build were blocked by temporary `codex[1m] safety-classifier unavailable`; manual retry required.
- Follow-up: restart dev app, retry one direct TikTok URL in WAV and MP3; confirm output path and audio playback.

## 2026-07-30 — Fix TikTok direct-video routing

- Changed: TikTok URLs containing creator handle plus `/video/<id>` now classify as direct `video` before generic `/@` channel matching. This routes Queue direct TikTok URLs through bounded download fallback instead of channel enumeration.
- Files: [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts), [tests/unit/backend/youtubeDownloader.test.ts](tests/unit/backend/youtubeDownloader.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Dev logs showed `@dvlm.fan/video/7664222020757998870` classified as `channel`; `downloadChannel()` called TikTok listing twice, so direct-video fallback never ran.
- Preserved: TikTok profile/channel classification, direct download output/audio settings, cookies, cancellation, generic YouTube/Facebook routing.
- Verification: focused Vitest passed — 2 files, 6 tests; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed. Local yt-dlp: `2026.07.20.234742`.
- Follow-up: restart dev app so rebuilt `dist-electron` loads; retry direct TikTok URL. If same rehydration error remains after fallback, upstream yt-dlp extractor still fails; test only direct `/video/<id>` URLs, not TikTok profile URLs.

## 2026-07-30 — Queue-local audio downloads and TikTok fallback hardening

- Changed: Download Queue has independent audio-only MP3/WAV controls and shows active Queue mode in summary. Queue cancellation now stops after current item and leaves later items pending. Direct TikTok downloads use one bounded fallback only for `Unable to extract universal data for rehydration`. Download output parsing now accepts `[ExtractAudio] Destination`, merger destinations, validates an existing non-empty output under the selected folder, and rejects exit code 0 without a verified file.
- Files: [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [src/pages/Video/queueDownloadRequest.ts](src/pages/Video/queueDownloadRequest.ts), [backend/youtube/youtubeDownloader.ts](backend/youtube/youtubeDownloader.ts), [tests/unit/queueDownloadRequest.test.ts](tests/unit/queueDownloadRequest.test.ts), [tests/unit/backend/youtubeDownloader.test.ts](tests/unit/backend/youtubeDownloader.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Queue audio needed independent intent; audio post-processing could be reported as empty/stale output; cancellation could start later URLs; TikTok extractor needed a narrow fallback.
- Preserved: single-download audio controls, queue output folder/order, yt-dlp media options and progress, non-TikTok one-attempt behavior, direct-TikTok-only fallback scope. Queue intentionally omits selected mixed-platform `cookiesFile`; use browser cookies or per-platform Cookie Manager fallback.
- Verification: focused Vitest passed — 2 files, 5 tests; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed. Manual TikTok MP3/WAV and cancel smoke remains pending.
- Follow-up: test two direct TikTok URLs in Queue MP3 and WAV; cancel first and confirm second stays pending. Profile/channel extraction repair remains out of scope; private/login-restricted/upstream-unsupported TikTok content can still fail.

## 2026-07-29 — Fix Enhance Audio preset stale effects

- Changed: Renderer preset application resets all eight effect groups to local defaults before overlaying partial preset values; omitted groups now become disabled defaults.
- Files: [src/pages/Music/EnhanceAudio/index.tsx](src/pages/Music/EnhanceAudio/index.tsx), [src/pages/Music/EnhanceAudio/presets.ts](src/pages/Music/EnhanceAudio/presets.ts), [tests/unit/enhanceAudioPresets.test.ts](tests/unit/enhanceAudioPresets.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Switching presets left omitted noiseGate/noiseReduction and other enabled groups stale, causing silent or corrupt exports.
- Preserved: output/export format, duration, paths, cancellation, progress, IPC shape, PresetsPanel behavior, backend and FFmpeg code.
- Verification: `npx vitest run tests/unit/enhanceAudioPresets.test.ts --config ./vitest.config.ts --pool=forks --maxWorkers=1 --reporter=verbose` passed — 1 file, 1 test; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed.
- Follow-up: manual smoke test with Noise Cleanup/Podcast then YouTube/Spotify preset; verify output has audible signal.

## 2026-07-28 — Auth hardening for final export and JWT secret

- Changed: JWT signing/verification now fails closed when `JWT_SECRET` is missing, blank, or the known placeholder; final video export, its scans, and Autopilot start now require main-process auth state `allowed` with username and machine ID; malformed final-export payloads never fall back to raw execution data; final export rechecks auth after resource confirmation.
- Files: [server/utils/jwt.ts](server/utils/jwt.ts), [server/auth-v2-handlers.ts](server/auth-v2-handlers.ts), [electron/authState.ts](electron/authState.ts), [electron/handlers/videoFinalExportHandlers.ts](electron/handlers/videoFinalExportHandlers.ts), [electron/handlers/autopilotHandlers.ts](electron/handlers/autopilotHandlers.ts), [tests/unit/server/jwt.test.ts](tests/unit/server/jwt.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Modified Electron clients could invoke final-export IPC without renderer auth, and missing Worker JWT secret enabled predictable token signing.
- Preserved: existing device-token exact-match and refresh-token machine-mismatch enforcement, offline local auth behavior after local auth is allowed, final-export error/cancel/path/queue lifecycle, public export telemetry, version policy, and R2 code. Scan IPC now requires allowed auth because it returns local paths/metadata.
- Verification: `npx vitest run tests/unit/server/jwt.test.ts tests/unit/server/autoBlock.test.ts tests/unit/server/securityReportEndpoint.test.ts --config ./vitest.config.ts --pool=forks --maxWorkers=1 --reporter=verbose` passed — 3 files, 9 tests; `npm run build` passed with existing dynamic-import/font/hash-sentinel warnings; `git diff --check` passed. `npx tsc --noEmit` remains blocked by pre-existing TS6305 declaration-output errors; `npm run lint` unavailable because `eslint` is not installed/resolvable. No deploy, secret rotation, release upload, or commit performed.
- Follow-up: configure strong Worker `JWT_SECRET` before deploying; rotate exposed Cloudflare/admin/JWT/installer credentials and disable or redesign public R2 upload separately; reconcile stale cached-auth revocation behavior, shared Autopilot/manual export locking, sender-bound cancellation, and export cancellation lifecycle before release.
- Review status: IPC QA found no blocker/high channel drift, but five medium findings remain: final-export schema passthrough leaves optional FFmpeg fields under-validated; scan source types permit `undefined`; `scanImageSource` type is optional while preload always exposes it; late cancel errors can overwrite idle renderer state; tracking sends `null` values rejected by Worker schema. Current patch is not merge-safe until these are addressed.
- Verification follow-up: focused JWT/security tests passed (3 files, 9 tests) and `tests/unit/fixes/bugFixes.test.ts` passed (22 tests); broader auth/queue/Autopilot run is blocked by Electron mock missing `protocol`; `npx tsc --noEmit` remains blocked by TS6305 declaration-output errors; `npm run lint` cannot resolve `eslint`. No deploy, secret rotation, release upload, commit, or push performed.

## 2026-07-23 — Build Windows EXE 4.4.4

- Changed: Bumped app and fallback policy version to `4.4.4`; built NSIS installer, portable EXE, blockmap, and updater metadata.
- Files: [package.json](package.json), [package-lock.json](package-lock.json), [server/env.ts](server/env.ts), [dist-electron-output/latest.yml](dist-electron-output/latest.yml), [dist-electron-output/93-media-tool-mix-nhac-setup-4.4.4.exe](dist-electron-output/93-media-tool-mix-nhac-setup-4.4.4.exe), [dist-electron-output/93-media-tool-mix-nhac-setup-4.4.4.exe.blockmap](dist-electron-output/93-media-tool-mix-nhac-setup-4.4.4.exe.blockmap), [dist-electron-output/93-media-tool-mix-nhac-4.4.4-portable.exe](dist-electron-output/93-media-tool-mix-nhac-4.4.4-portable.exe), [HANDOFF.md](HANDOFF.md).
- Why: User requested Windows EXE 4.4.4 for testing.
- Preserved: updater auto-download/install guards, bundled FFmpeg/ffprobe/ffplay/yt-dlp resources, unrelated dirty working-tree changes.
- Verification: `npm run build:win` exit 0; `latest.yml` reports `version: 4.4.4`; installer 368,996,322 bytes; blockmap 380,130 bytes; portable 368,766,194 bytes. Build warnings remain unresolved font URLs, dynamic import chunks, default Electron icon, duplicate dependencies, Node `DEP0190`, and hash sentinel notice.
- Follow-up: Upload installer, portable EXE, blockmap, and `latest.yml` to GitHub release repo before auto-update testing.

## 2026-07-23 — Fix Song Nhạc StrictMode audio graph

- Changed: Delay `createMediaElementSource()` until user starts preview and reuse one graph per HTML audio element; cleanup remains unmount-only.
- Files: [src/pages/Music/SongNhacPage.tsx](src/pages/Music/SongNhacPage.tsx), [HANDOFF.md](HANDOFF.md).
- Why: React StrictMode development effect replay created a second MediaElementSourceNode and crashed preview with `InvalidStateError`.
- Preserved: Canvas renderer, FFT settings, audio path protocol, export IPC/FFmpeg, duration semantics.
- Verification: Focused source-level fix; manual retest required in running dev app: open Sóng nhạc, select audio, click Play twice, switch tabs and return.
- Follow-up: Add browser lifecycle test when renderer test environment exists.

## 2026-07-22 — Song Nhạc V1 Canvas visualizer

- Changed: Added clean-room Song Nhạc V1 page with deterministic Canvas 2D pseudo-3D renderer, Web Audio FFT preview, local `app://local-file` audio input, typed Song Nhạc IPC channels, guarded MP4 export handler, and three visual styles (`neon-tunnel`, `orbit-spectrum`, `pulse-grid`).
- Files: [src/pages/Music/SongNhacPage.tsx](src/pages/Music/SongNhacPage.tsx), [src/features/song-nhac/core/types.ts](src/features/song-nhac/core/types.ts), [src/features/song-nhac/core/audioBands.ts](src/features/song-nhac/core/audioBands.ts), [src/features/song-nhac/core/renderSongNhacFrame.ts](src/features/song-nhac/core/renderSongNhacFrame.ts), [shared/songNhacChannels.ts](shared/songNhacChannels.ts), [electron/handlers/songNhacHandlers.ts](electron/handlers/songNhacHandlers.ts), [electron/preload.ts](electron/preload.ts), [src/types/ipc.ts](src/types/ipc.ts), [electron/handlers/index.ts](electron/handlers/index.ts), [src/router.tsx](src/router.tsx), [src/components/Sidebar.tsx](src/components/Sidebar.tsx), [backend/video/songNhacFfmpegPipe.ts](backend/video/songNhacFfmpegPipe.ts), [tests/unit/songNhacAudioBands.test.ts](tests/unit/songNhacAudioBands.test.ts), [tests/unit/songNhacRender.test.ts](tests/unit/songNhacRender.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Rebuild visualizer for fast, stable packaged Electron preview/export without adding WebGL/R3F dependencies or copying old worktree module.
- Preserved: existing final-export/autopilot stacks, Windows `app://local-file` protocol, audio duration measured from ffprobe in export, current unrelated dirty changes, no package/version bump.
- Verification: focused Song Nhạc tests pass — 2 files, 4 tests. `npm run build` passes. `npx tsc --noEmit` remains blocked by pre-existing TS6305 stale declaration outputs. Build warnings remain unresolved font URLs, dynamic import chunks, default Electron icon, duplicate dependencies, Node `DEP0190`, and hash sentinel notice.
- Follow-up: IPC/media specialist review; manual Electron smoke with local Unicode/space path, play/pause/seek, three styles, output overwrite/cancel behavior, packaged FFmpeg path. Export currently uses FFmpeg-generated visual filter path; shared Canvas renderer parity and long-track backpressure need dedicated follow-up before release.

## 2026-07-22 — Autopilot explicit save and multiline video roots

- Changed: Plan Mode now uses explicit localStorage save with visible dirty/save-error state and browser unload warning; root video folder editor accepts editable newline/CRLF/semicolon roots; audio/final picker behavior stays single-path; runner validation and scan IPC share delimiter parsing.
- Files: [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [electron/handlers/autopilotHandlers.ts](electron/handlers/autopilotHandlers.ts), [tests/unit/backend/autopilotRunner.test.ts](tests/unit/backend/autopilotRunner.test.ts), [HANDOFF.md](HANDOFF.md).
- Why: Plan Mode silently hid localStorage failures, root picker appended unsupported audio/final paths, and preview/start parsing disagreed on semicolon-delimited video roots.
- Preserved: renderer-local persistence authority, Audio/Final date-subfolder output, video root direct scan semantics, Autopilot start/progress/cancel lifecycle, existing IPC channel and preload shape.
- Verification: `git diff --check` passed. Focused Vitest and `npm run build` were blocked by temporary safety-classifier outage in this session; IPC pair read manually: handler registration, preload `scanVideoFolders`, and `IPCAPI` signature remain aligned. Manual renderer smoke pending.
- Follow-up: Run `npx tsc --noEmit`; manually verify Save/reload, failed localStorage write warning, beforeunload warning, editable folder semantics, and start/cancel.
- Build follow-up 2026-07-22: `npm run build:win` passed; focused Autopilot test remains blocked before collection by existing `TypeError: Cannot read properties of undefined (reading 'config')` in Vitest setup. Existing `jobQueue.test.ts` hits same setup error. Build warnings: unresolved font URLs, dynamic-import chunk warnings, default Electron icon, duplicate dependency references, Node `DEP0190`, and missing hash sentinel notice.

## 2026-07-22 — Global unique video planning and export lifecycle

## 2026-07-22 — Global unique video planning and export lifecycle

- Changed: Added global video batch planner with physical-path deduplication, duration capacity failure, exact per-job clip sequences, strict no-placeholder behavior, and cross-day reservation for unique Autopilot exports.
- Files: [backend/video/utils/videoPlaylistPlan.ts](backend/video/utils/videoPlaylistPlan.ts), [backend/video/finalExport.ts](backend/video/finalExport.ts), [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts), [backend/jobQueue/jobQueue.ts](backend/jobQueue/jobQueue.ts), [electron/handlers/videoFinalExportHandlers.ts](electron/handlers/videoFinalExportHandlers.ts), [electron/main.ts](electron/main.ts), [electron/preload.ts](electron/preload.ts), [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx), [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [tests/unit/backend/videoPlaylistPlan.test.ts](tests/unit/backend/videoPlaylistPlan.test.ts), [tests/unit/backend/jobQueue.test.ts](tests/unit/backend/jobQueue.test.ts).
- Why: Video Pool/LRU could not guarantee cross-output uniqueness; final export rebuilt playlists per job and IPC cancellation could leave pending/late-completing jobs.
- Verification: `npm run build` pass. Focused Vitest `npx vitest run tests/unit/backend/jobQueue.test.ts tests/unit/backend/videoPlaylistPlan.test.ts --config ./vitest.config.ts --pool=forks --maxWorkers=1 --reporter=verbose` — 16 passed. `git diff --check` passed. `npx tsc --noEmit` remains blocked by pre-existing TS6305 stale declaration outputs.
- Follow-up: Run clean project typecheck after regenerating declaration outputs; add integration test for final-export handler cancellation during resource confirmation.

- 2026-07-22 follow-up: IPC request/scan IDs now require trimmed non-empty strings; invalid cancel IDs return failure; destroyed listeners clean up on terminal paths. Build and focused tests re-run.

---

# HANDOFF

## 2026-07-21

### Video Pool P0 identity, order, output safety, and start guards
- Files touched:
  - [backend/autopilot/videoPool.ts](backend/autopilot/videoPool.ts) — canonical realpath-based IDs, physical alias dedup, partial-sync prune protection, serialized pool writes, actual path usage commits.
  - [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts) — retain pool order, return actual final-export result, mark only successfully emitted pool occurrences.
  - [backend/video/finalExport.ts](backend/video/finalExport.ts) — preserve explicit file order, rotate priority clips by job index, expose actual video sequences, reject existing output files, use FFmpeg no-clobber output mode.
  - [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) — add backward-compatible `videoSequences` evidence field.
  - [electron/handlers/videoFinalExportHandlers.ts](electron/handlers/videoFinalExportHandlers.ts) — synchronous owner guard against rapid duplicate final-export starts.
  - [electron/handlers/videoHandlers.ts](electron/handlers/videoHandlers.ts) — owner-bound merge in-flight guard.
  - [HANDOFF.md](HANDOFF.md) — continuity entry.
- Why: Video Pool previously collapsed same-name/same-size files, pruned valid clips from partial selections, lost ordering before concat, recorded candidate rather than emitted sequences, and allowed output overwrite/double-start races.
- Preserved: duration/fill behavior, strict pairing semantics, FFmpeg scratch overwrite behavior, existing IPC event shapes; merge queue/remount refactor remains out of scope.
- Verification: focused Vitest `tests/unit/backend/videoUtils.test.ts tests/unit/backend/scanMusic.test.ts tests/unit/backend/scanStore.test.ts` passed (3 files, 10 tests); `npm run build` passed. `npx tsc --noEmit` blocked by pre-existing TS6305 declaration-output errors across repo. `git diff --check` passed.
- Follow-up: add dedicated Video Pool/final-export/handler race tests and finish queue/request-ID lifecycle alignment before release.

---


## 2026-07-21

### Fix audio preview fallback for local and UNC playlist files
- Files touched:
  - [src/pages/Music/PreviewPlaylistPage.tsx](src/pages/Music/PreviewPlaylistPage.tsx) — replace blocked `file://` fallback with existing `app://local-file` stream URL while retaining base64-first playback.
  - [electron/main.ts](electron/main.ts) — validate protocol paths, reject directories, and decode URL query exactly once so spaces, Unicode, UNC, and literal `%` paths work.
  - [tests/unit/previewPlaylistAudioUrl.test.ts](tests/unit/previewPlaylistAudioUrl.test.ts) — cover Windows and UNC URL round trips.
  - [HANDOFF.md](HANDOFF.md) — continuity entry.
- Why: Step 3 preview showed generic audio load errors when base64 IPC failed; renderer fallback used `file://`, which sandboxed packaged renderer blocks and mishandles UNC paths.
- Preserved: base64-first path, export pipeline, IPC/preload/types, source path values.
- Verification: `git diff --check` pass. Focused Vitest and `npm run build` pending because command execution was blocked by a temporary safety-classifier outage.
- Follow-up: run `npx vitest run tests/unit/previewPlaylistAudioUrl.test.ts tests/unit/fixes/bugFixes.test.ts --reporter=verbose`, `npm run build`, then smoke test existing MP3/M4A/WAV plus missing file and `100% mix.mp3` in dev and packaged builds.

---

## 2026-07-21

### Playlist identity and cross-playlist order uniqueness
- Files touched:
  - [backend/music/scanMusic.ts](backend/music/scanMusic.ts) — hash canonical `realpath` for stable scan IDs and deduplicate one physical file across priority/random roots, with priority-first ownership.
  - [backend/music/scanStore.ts](backend/music/scanStore.ts) — reject stale scan cache entries with legacy IDs or duplicate IDs.
  - [backend/music/playlistEngine.ts](backend/music/playlistEngine.ts) — replace random duplicate retries with deterministic rotations and fail clearly when requested playlist count cannot produce unique ordered track signatures.
  - [tests/unit/backend/scanMusic.test.ts](tests/unit/backend/scanMusic.test.ts) — cover stable IDs, overlapping-root dedup, priority ownership, and distinct files.
  - [HANDOFF.md](HANDOFF.md) — continuity entry.
- Why: one export batch could contain playlists with identical track order; overlapping scan roots could count one physical file more than once.
- Preserved: original media paths, pinned/group ordering, duration/cumulative duration, reuse and crossfade target semantics, IPC shape.
- Verification: `git diff --check` pass; `npx vitest run tests/e2e/songNhac.e2e.ts tests/unit/backend/scanMusic.test.ts tests/unit/backend/scanStore.test.ts --reporter=verbose` pass — 3 files, 23 tests. Build chưa chạy.
- Follow-up: run `npm run build` before release.

---

Cross-session changelog. **Newest entries on top.** Every feature update or bug fix in this project is logged here so the next session can pick up without re-reading transcripts.

**Format per entry:**
- Date (YYYY-MM-DD)
- What changed (one line)
- Files touched (with line refs when useful)
- Why (the reason, not the steps)

---

## 2026-07-11

### Thêm agent sửa code tối thiểu và agent đọc tài liệu read-only
- Files touched:
  - [.claude/agents/minimal-change-applier.md](.claude/agents/minimal-change-applier.md) — specialist áp dụng yêu cầu code rõ ràng bằng diff nhỏ nhất, giữ dirty tree, chạy targeted verification và cập nhật HANDOFF sau thay đổi thật.
  - [.claude/agents/repository-docs-reader.md](.claude/agents/repository-docs-reader.md) — specialist hard read-only để đọc, đối chiếu, tóm tắt docs repo/web với Fact/Inference/Unknown và citation.
  - [.claude/skills/minimal-change-apply/SKILL.md](.claude/skills/minimal-change-apply/SKILL.md), [.claude/skills/repository-docs-research/SKILL.md](.claude/skills/repository-docs-research/SKILL.md) — routing, domain gates, trigger/near-miss matrix và dry-run scenarios cho hai agent.
  - [CLAUDE.md](CLAUDE.md) — đăng ký trigger pointer, giữ `harness-orchestrator` review-only.
  - [HANDOFF.md](HANDOFF.md) — ghi thay đổi theo rule dự án.
- Why: harness hiện có specialist review theo domain nhưng thiếu executor ngang repo cho scoped code change và reader chuyên tổng hợp tài liệu repo/upstream mà không có quyền ghi.
- Verification: Node assertion kiểm frontmatter/section bắt buộc và tool allowlist pass; docs reader không có write/shell tools; `git diff --check` pass. Hai custom agent chưa smoke-run được trong session hiện tại vì agent registry chưa refresh (`Agent type ... not found`); cần xác minh discovery trong session mới.
- Follow-up: mở session mới từ repo chính, chạy một prompt gate cho `minimal-change-applier` và một prompt repo-only cho `repository-docs-reader`; theo dõi false-positive trigger trước khi thêm hook/settings.

## 2026-07-08

### Build Windows EXE 4.4.3 cho auto-update test
- Files touched:
  - [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) — sửa IPC type drift: `videoSource` optional cho slideshow ảnh-only; `FinalExportScanResult.kind` thêm `image` để khớp `scanImageSource` runtime.
  - [dist-electron-output/latest.yml](dist-electron-output/latest.yml), `dist-electron-output/93-media-tool-mix-nhac-setup-4.4.3.exe`, `dist-electron-output/93-media-tool-mix-nhac-setup-4.4.3.exe.blockmap`, `dist-electron-output/93-media-tool-mix-nhac-4.4.3-portable.exe` — artifact Windows build local sau fix IPC type drift.
  - [HANDOFF.md](HANDOFF.md) — ghi lại build theo rule dự án.
- Why: user muốn build bản `4.4.3` để test auto-update và yêu cầu kiểm lại IPC/API nối có ổn không.
- Verification: `package.json`, `package-lock.json`, [server/env.ts](server/env.ts) đều ở `4.4.3`; resource đóng gói có đủ `ffmpeg/ffprobe/ffplay/yt-dlp/AtomicParsley/license_public_key/installer.nsh`; updater guard còn `autoDownload=false`, `autoInstallOnAppQuit=false`, `app:installUpdate` chặn khi export active; manual IPC/API QA không thấy blocker sau khi fix type drift; `npm run build:win` exit 0; `latest.yml` ghi `version: 4.4.3`; installer size `387573884`, portable size `387343754`, blockmap size `399466`.
- Warnings: build còn warnings cũ dynamic import/font asset/inject-hash sentinel; electron-builder dùng default icon, duplicate dependency references, Node `DEP0190`.
- Follow-up: cần upload `setup`, `.blockmap`, `latest.yml` lên GitHub Release feed để client thật sự nhận auto-update.

### Build Windows EXE 4.4.2
- Files touched:
  - [package.json](package.json), [package-lock.json](package-lock.json) — đổi app version sang `4.4.2` để electron-builder đặt version đúng trong installer/portable.
  - [dist-electron-output/latest.yml](dist-electron-output/latest.yml), `dist-electron-output/93-media-tool-mix-nhac-setup-4.4.2.exe`, `dist-electron-output/93-media-tool-mix-nhac-setup-4.4.2.exe.blockmap`, `dist-electron-output/93-media-tool-mix-nhac-4.4.2-portable.exe` — artifact Windows build local.
  - [HANDOFF.md](HANDOFF.md) — ghi lại build theo rule dự án.
- Why: user yêu cầu build bản EXE `4.4.2`.
- Verification: `npm run build:win` exit 0; `latest.yml` ghi `version: 4.4.2`; installer size `387574379`, portable size `387344208`, blockmap size `399471`.
- Warnings: build còn warnings cũ dynamic import/font asset/inject-hash sentinel; electron-builder dùng default icon và báo duplicate dependency references/Node DEP0190.
- Follow-up: [server/env.ts](server/env.ts) vẫn có `DEFAULT_POLICY_VERSION = '4.4.3'`; nếu Worker policy đang `min_supported_version=4.4.3`, app 4.4.2 có thể bị policy/update chặn. Chỉ dùng bản 4.4.2 này khi server policy cho phép.

### NumericDraftInput dùng cho Autopilot/Music/YouTube/sóng nhạc
- Files touched:
  - [src/components/NumericDraftInput.tsx](src/components/NumericDraftInput.tsx) — helper input số giữ draft khi người dùng xóa/gõ dở, commit số hợp lệ, clamp khi blur.
  - [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx), [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx) — Plan/Batch numeric fields dùng helper, cho phép xóa trắng rồi nhập lại, sửa lỗi JSX thiếu `}` ở nút chạy batch.
  - [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx), [src/pages/Music/ExportAudioPage.tsx](src/pages/Music/ExportAudioPage.tsx), [src/pages/Music/EnhanceAudio/LimiterPanel.tsx](src/pages/Music/EnhanceAudio/LimiterPanel.tsx), [src/pages/Music/EnhanceAudio/LoudnormPanel.tsx](src/pages/Music/EnhanceAudio/LoudnormPanel.tsx), [src/pages/Music/EnhanceAudio/index.tsx](src/pages/Music/EnhanceAudio/index.tsx) — playlist/crossfade/enhance numeric inputs dùng helper thay vì parse trực tiếp lúc đang gõ.
  - [src/pages/Video/YouTubeDownloaderTab.tsx](src/pages/Video/YouTubeDownloaderTab.tsx), [src/pages/Video/FinalExportTab.tsx](src/pages/Video/FinalExportTab.tsx) — giới hạn tải/min duration và thông số sóng nhạc dùng helper.
  - [HANDOFF.md](HANDOFF.md) — ghi lại thay đổi theo rule dự án.
- Why: input số cũ tự ép value trong lúc đang gõ nên khó xóa trắng/nhập lại; cần hành vi draft ổn định cho các màn hình cấu hình.
- Verification: grep `type="number"` trên các file mục tiêu không còn match; `npm run build` exit 0. Warnings còn lại là dynamic import/font asset/inject-hash sentinel cũ.
- Follow-up: còn `type="number"` ở [src/pages/Video/MergeTab.tsx](src/pages/Video/MergeTab.tsx), [src/pages/Video/MultiCutTab.tsx](src/pages/Video/MultiCutTab.tsx), [src/pages/Video/SingleCutTabSimple.tsx](src/pages/Video/SingleCutTabSimple.tsx) ngoài scope yêu cầu hiện tại.

### UI Quét nhạc gọn hơn + giữ cấu hình Autopilot/Batch sau update
- Files touched:
  - [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx) — bỏ nút test khỏi UI scan, gom action scan vào header, giữ scan đa thể loại, chuyển tool chuẩn hóa bitrate và bảng preview bài hát sang `<details>` mặc định gọn, summary đổi thành stat tile.
  - [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx) — autosave Batch chỉ lưu config, không lưu runtime `status/error/message`; số playlist/phút/clip mục tiêu cho phép xóa rỗng rồi nhập lại, khi chạy mới clamp/default.
  - [src/pages/AutopilotPage.tsx](src/pages/AutopilotPage.tsx) — Plan Mode numeric inputs dùng parser cho phép rỗng rồi nhập lại; config gửi backend mới clamp/default, autosave vẫn giữ đúng trạng thái người dùng đang nhập.
  - [backend/utils/cacheCleanup.ts](backend/utils/cacheCleanup.ts) — version cleanup không xóa `Local Storage`/`IndexedDB` nữa để không làm mất config renderer như Autopilot/Batch.
  - [HANDOFF.md](HANDOFF.md) — ghi lại thay đổi theo rule dự án.
- Why: user thấy UI quét nhạc lộn xộn và muốn Autopilot/Batch nhớ cấu hình sau khi mở lại app; numeric inputs trước đó tự bật về default khi xóa nên dễ nhập nhầm.
- Verification: `npm run build` exit 0. Warnings còn lại là warnings cũ dynamic import/font asset/inject-hash sentinel.
- Follow-up: cần smoke manual trong app: Quét nhạc, Tạo playlist đọc lại scan cache, Batch Mode close/reopen giữ config, thử xóa trắng rồi nhập lại các ô số trong Plan/Batch.

## 2026-07-08

### Quét nhạc — nhiều thể loại + cache scan theo path
- Files touched:
  - [backend/music/scanMusic.ts](backend/music/scanMusic.ts), [backend/music/scanStore.ts](backend/music/scanStore.ts), [electron/handlers/musicHandlers.ts](electron/handlers/musicHandlers.ts), [shared/ipcSchemas.ts](shared/ipcSchemas.ts), [src/types/ipc.ts](src/types/ipc.ts) — mở rộng scan payload từ 2 folder cố định sang nhiều thể loại, thêm metadata genre/sourceFolder, reuse cache khi config giống và mọi path còn tồn tại.
  - [src/pages/Music/ScanMusicPage.tsx](src/pages/Music/ScanMusicPage.tsx), [src/pages/Music/CreatePlaylistPage.tsx](src/pages/Music/CreatePlaylistPage.tsx) — Tab 1 quản lý nhiều thể loại/folder, hydrate kết quả đã lưu; Tab 2 load backend cache và lọc tạo playlist theo thể loại.
  - [backend/autopilot/autopilotRunner.ts](backend/autopilot/autopilotRunner.ts) — Autopilot scan nhạc với `persist:false`/`forceRescan:true` để không ghi đè cache Tab 1.
  - [tests/unit/backend/scanMusic.test.ts](tests/unit/backend/scanMusic.test.ts), [tests/unit/backend/scanStore.test.ts](tests/unit/backend/scanStore.test.ts) — check normalize legacy payload và cache usability theo path.
- Why: user muốn quét nhiều thể loại nhạc và lần sau mở lại dùng dữ liệu đã quét nếu file vẫn ở đường dẫn cũ, không nhập folder/quét lại từ đầu.
- Post-feedback fix: renderer gửi kèm `priorityFolder`/`randomFolder` đầu tiên cùng payload `genres` để dev app/main cũ không còn báo `No folders provided`; Tab 2 dropdown thể loại giờ lấy từ cả `config.genres` và metadata `track.genreId`, header hiển thị số bài của thể loại đang chọn.
- Verification: `npm run build` exit 0; `npx vitest run tests/unit/backend/scanMusic.test.ts tests/unit/backend/scanStore.test.ts --reporter=verbose` chạy bằng PowerShell exit 0 (Bash Git shell bị lỗi Vitest project config pre-import, cả test cũ cũng lỗi tương tự).
- Follow-up: cache chỉ kiểm path tồn tại, không hash/mtime nội dung; nếu thêm/xóa/sửa file trong folder thì bấm `Quét lại từ đầu`.

## 2026-07-08

### Autopilot Batch Mode — dán folder path + chạy riêng từng thể loại
- Files touched:
  - [src/pages/Autopilot/BatchModeTab.tsx](src/pages/Autopilot/BatchModeTab.tsx) — folder textareas trong Batch Mode cho nhập/dán trực tiếp path, giữ picker `Chọn`/`Xóa`; `runBatch` nhận queue một row hoặc toàn bộ batch; thêm nút `Chạy` ở từng thể loại và giữ nút `Chạy Batch` tổng.
  - [HANDOFF.md](HANDOFF.md) — ghi lại thay đổi theo rule dự án.
- Why: user muốn paste folder path thay vì luôn mở picker và muốn chạy riêng một thể loại khi Batch Mode có nhiều thể loại, không mất chế độ chạy batch tuần tự.
- Follow-up: nếu cần paste nhiều folder bằng dấu `;` cho `Video đã cắt`, cần chuẩn hóa parser/validation backend; hiện hỗ trợ multiline như flow picker đang dùng.

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
