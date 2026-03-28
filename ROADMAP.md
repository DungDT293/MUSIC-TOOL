## 93 Media Tool Mix Nhạc – Roadmap

File này mô tả roadmap theo **code hiện tại** (dựa trên các thư mục/feature đang tồn tại trong `src/features`) và những bước nên làm tiếp theo.

---

## 1. Tổng quan kiến trúc hiện tại

- **Desktop app (Electron)**  
  - Khởi chạy ứng dụng, preload `window.api.*`, đọc/ghi user data, log, license.
  - Liên quan: lỗi `window.api is not available`, `authState.enc`, logs trong `%APPDATA%\93-media-tool-mix-nhac\`.

- **Feature: `song-nhac/` – Visualizer mix nhạc chính**
  - `SongNhacScreen.tsx`: màn hình chính.
  - `runtime/`:
    - `VisualizerRuntime.ts`, `canvas/CanvasHost.ts`, `resizeCanvasToContainer.ts`, `fpsMeter.ts`.
    - `render/drawLayers.ts`, `render/songNhacLayersToDrawable.ts`, `render/renderTestPattern.ts`.
    - `export/renderOneFrame.ts`, `export/types.ts`, `engine/` (các engine dạng sóng – ví dụ WaveBars, WaveRing,...).
  - `store/`:
    - `songNhacLayerStore.ts`: danh sách layer, thêm/xóa/nhân bản, nhóm, z-order.
    - `songNhacRuntimeStore.ts`: trạng thái runtime (play/stop, sóng quanh ảnh, audio waveform, v.v.).
    - `songNhacTimelineStore.ts`: timeline, in/out của layer, playhead.
    - `songNhacExportStore.ts`: cấu hình export, preset, tiến trình render.
    - `songNhacTemplateStore.ts`: template / preset layout.
  - `panels/`:
    - `LayersPanel.tsx`: panel layer bên trái.
    - `InspectorPanel.tsx`: chỉnh chi tiết layer, bật/tắt sóng quanh ảnh, v.v.
    - `EnginesPanel.tsx`: chọn engine/kiểu visualizer.
  - `timeline/`:
    - `useTimelineCompute.ts`: tính toán dữ liệu hiển thị timeline từ store.
    - `worker/computeBeats.ts`, `worker/timelineWorker.ts`: worker tính beat, phân tích waveform/audio.
  - `export/`:
    - `ExportDialog.tsx`, `ExportPresetSelector.tsx`: UI export.
    - `exportConfigTypes.ts`, `IpcFrameSink.ts`: truyền frame ra process export (IPC).
  - Khác:
    - `AudioSourceSelector.tsx`: chọn nguồn audio.
    - `PreviewViewport.tsx`: khung preview.
    - `toolbar/VisualizerToolbar.tsx`, `toolbar/TransportBar.tsx`: thanh công cụ, play/pause, v.v.
    - `gizmo/GizmoOverlay.tsx`, `gizmo/gizmoUtils.ts`: điều khiển kéo/thả/scale/rotate layer trên canvas.
    - `types/layerTypes.ts`: định nghĩa kiểu layer (ảnh, text, v.v.).
    - `hooks/useSongNhacKeyboardShortcuts.ts`: phím tắt editor.

- **Feature: `visualizer/` (Avee-style)**
  - `VisualizerWorkspace.tsx`, `VisualizerTab.tsx`: khung làm việc cho visualizer.
  - `vizParser.ts`: parser preset Avee.
  - `LayerPropertiesPanel.tsx`, `EffectsPanel.tsx`, `TimelinePanel.tsx`: UI chỉnh layer/effect/timeline cho visualizer.

---

## 2. Roadmap giai đoạn ngắn hạn (Short-term, ưu tiên cao)

- **Song-nhac timeline – Hoàn thiện 1.0**
  - [ ] Hoàn thiện UI timeline cho layer:
    - [ ] Kéo/đổi vị trí block layer trên thanh thời gian (theo in/out).
    - [ ] Zoom timeline (theo thời gian, ví dụ slider hoặc Ctrl + scroll).
    - [ ] Ruler thời gian (giây/bars) + playhead rõ ràng.
  - [ ] Snapping:
    - [ ] Snap block layer vào beat tính từ `computeBeats.ts`.
    - [ ] Snap vào đầu/cuối các layer khác (giống video editor).
  - [ ] Hiệu suất:
    - [ ] Tránh tính toán O(n²) khi kéo/di chuyển nhiều layer.
    - [ ] Chỉ re-render các phần timeline cần thiết.

- **Export preset – Trải nghiệm "một click"**
  - [ ] Thêm preset nhanh (ví dụ: 1080p 9:16, 1080p 16:9, 720p 1:1).
  - [ ] Cho phép lưu preset export tùy chỉnh từ UI (`ExportDialog.tsx`):
    - [ ] Resolution, FPS, bitrate, encoder, v.v.
    - [ ] Chọn preset mặc định.
  - [ ] Hiển thị rõ trạng thái export:
    - [ ] Progress, ETA, số frame đã render.
    - [ ] Log lỗi export (IPC error, FFmpeg, v.v.) thân thiện người dùng.

- **Sóng quanh ảnh & engine visualizer**
  - [ ] Đồng bộ UI chọn engine (ở `EnginesPanel.tsx`) với runtime engine (`runtime/engine/*`).
  - [ ] Thêm preset sóng/engine theo chủ đề (Ví dụ: “Minimal”, “Bass-heavy”, “Neon”, “Soft”).
  - [ ] Cho phép lưu/áp dụng preset engine trên nhiều project.

- **UX Editor**
  - [ ] Hoàn thiện multi-select và group trên timeline cho khớp với canvas:
    - [ ] Kéo nhiều block layer cùng lúc.
    - [ ] Group/ungroup từ panel layers và timeline.
  - [ ] Tooltip/hint cho các nút quan trọng (Export, Engine, Template, Audio).
  - [ ] Hiển thị trạng thái “Loading phân tích audio / computeBeats” khi mới chọn file nhạc.

---

## 3. Roadmap trung hạn (Mid-term)

- **Quản lý project & preset**
  - [ ] Hệ thống project:
    - [ ] Lưu project (layout layer, audio, preset engine, timeline).
    - [ ] Màn hình chọn/mở project gần đây.
  - [ ] Thư viện template/preset:
    - [ ] Kho template cho người dùng mới (pre-made layout + engine).
    - [ ] Import/export template dưới dạng file riêng (chia sẻ với người khác).

- **Nâng cấp audio & timeline**
  - [ ] Hỗ trợ **nhiều track audio** (main + effect/intro/outro).
  - [ ] Thêm marker trên timeline:
    - [ ] Marker beat/drop quan trọng.
    - [ ] Marker text/lyrics.
  - [ ] Chức năng loop đoạn chọn để chỉnh visualizer chuẩn beat.

- **Visualizer (Avee-style)**
  - [ ] Cải thiện parser `vizParser.ts`:
    - [ ] Hỗ trợ nhiều loại effect/layer hơn từ preset Avee.
    - [ ] Mapping tốt hơn từ preset Avee → engine nội bộ.
  - [ ] Cho phép chỉnh sửa sâu các thông số effect (color, blend, blur, glow, v.v.) từ `EffectsPanel.tsx`.

---

## 4. Roadmap dài hạn (Long-term / Nice-to-have)

- **Hiệu năng & chất lượng video**
  - [ ] Tối ưu pipeline render:
    - [ ] Batch render nhiều frame/lần nếu IPC + encoder cho phép.
    - [ ] Giảm copy buffer không cần thiết giữa main/preload/renderer.
  - [ ] Hỗ trợ nhiều preset encoder:
    - [ ] H.264, H.265, VP9 (tùy cấu hình/FFmpeg).
    - [ ] Preset tốc độ (ultrafast, medium, slow).

- **Trải nghiệm người dùng nâng cao**
  - [ ] Onboarding / hướng dẫn nhanh:
    - [ ] Tour trong app giới thiệu: chọn audio → chọn template → chỉnh layer → export.
    - [ ] Ví dụ project mẫu sẵn.
  - [ ] Undo/Redo “editor-grade” mọi hành động (layer, timeline, engine, preset).

- **Khả năng mở rộng**
  - [ ] Plugin system đơn giản (import script/JSON để thêm engine hoặc template mới).
  - [ ] API export CLI (chạy render từ dòng lệnh với file project/preset).

---

## 5. Checklist định nghĩa “Ổn để ship”

- [ ] Canvas + gizmo:
  - [ ] Kéo/scale/rotate layer mượt, không lag, không bug selection.
  - [ ] Group/multi-select hoạt động nhất quán giữa canvas và panel/timeline.
- [ ] Timeline:
  - [ ] In/out layer thể hiện đúng trên preview.
  - [ ] Snap theo beat/time hoạt động ổn định.
- [ ] Export:
  - [ ] Export không crash, có thông báo lỗi rõ ràng nếu fail.
  - [ ] Preset phổ biến (1080p 9:16, 16:9, 1:1) test OK.
- [ ] Audio:
  - [ ] Phân tích beat/timeline không làm UI đơ (worker hoạt động đúng).
  - [ ] Thay file nhạc không cần reload app.
- [ ] License & ổn định:
  - [ ] Các lỗi trong `TROUBLESHOOTING.md` hiếm khi xảy ra với user bình thường.
  - [ ] Log đủ để debug khi có sự cố.

---

_File này chỉ mô tả roadmap tổng quan dựa trên cấu trúc code hiện tại. Khi bạn hoàn thành một tính năng lớn, nên cập nhật thêm vào đây để luôn nắm được bức tranh toàn bộ của project._

