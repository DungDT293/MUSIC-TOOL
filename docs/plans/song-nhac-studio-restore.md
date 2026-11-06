# Kế hoạch: Khôi phục đầy đủ chức năng Sóng nhạc (studio như CapCut)

Ngày lập: 2026-11-06
Trạng thái: đang thực thi — P0, P1, P2, P4, P6 xong; P3/P5 một phần
Tài liệu tham chiếu: `legacy-song-nhac/` (106 file, ~20.158 dòng — chỉ đọc, đã gitignore)

## Tiến độ

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| P0 | ✅ | Export mang theo layer, z theo thứ tự mảng |
| P1 | ✅ | Model legacy + store zustand + history + page wiring |
| P2 | ✅ | Inspector 13 section (Transform, Ảnh/Video, Văn bản, Viền & bóng, Filter, Sóng, Thời gian) |
| P3 | 🟡 | LayersPanel đầy đủ (8 nút, group, multi-select, khoá) — **thiếu 10 preset sóng + template localStorage** |
| P4 | 🟡 | Gizmo kéo/xoay/zoom + phím tắt + undo/redo — **chưa có khung chọn và tay nắm** |
| P5 | 🟡 | Filter bake (ảnh/chữ), tham số sóng theo lớp — **thiếu beat pulse ảnh, sóng quanh ảnh** |
| P6 | ✅ | Độ phân giải, FPS, khoảng thời gian khi xuất |

Giới hạn đã biết:
- Nhiều lớp visualizer cùng lúc: engine chỉ dùng lớp cuối (một cụm sóng duy nhất).
- Video layer chưa áp được filter (phải bake mỗi frame).
- Chưa kiểm thử xuất MP4 end-to-end trong GUI (cần hộp thoại file thật).


---

## 1. Hiện trạng

| Hạng mục | Bản cũ (`6870fc7`) | Hiện tại |
|---|---|---|
| File / dòng | 106 file / ~20.158 dòng | 6 file studio + engine (~900 dòng) |
| Loại lớp | image, text, visualizer, video, **group** | image, text, video, visualizer |
| Transform | px so với tâm, **scaleX/scaleY độc lập**, flip | phân số -0.5..0.5, **1 scale** |
| Hiệu ứng | **15 trường filter** (brightness, contrast, saturation, hue, grayscale, sepia, blur, tint, shadow, borderRadius, opacity) | không có |
| Thời gian | **timeRange + fade in/out**, preset Intro/Outro | không có |
| Watermark | **role = watermark**, luôn vẽ trên cùng | không có |
| Inspector | 13 section, ~66 control | 8 control |
| Layers | toolbar 8 nút, group, multi-select, 10 preset, template localStorage | 3 nút, 1 chọn |
| Canvas | **gizmo kéo/thu/xoay + snap**, phím tắt, undo/redo (50 bước) | chưa có |
| Engine | 6 (3 dùng import động) | 1 (Three.js mới, đẹp hơn) |
| Xuất | hộp thoại preset + range + chọn codec | cố định 1080p30, **không mang theo lớp** |

### Hai lỗi nghiêm trọng cần sửa trước tiên

1. **`exportSongNhacFrames` không truyền `layers` vào engine** → video xuất ra chỉ có visualizer, mất toàn bộ ảnh/text/video/watermark. Người dùng thấy preview có lớp nhưng file MP4 không có.
2. **Thứ tự lớp không có tác dụng**: `AveeVisualizerEngine.applyLayerTransform` đặt z cứng (text 1.5, media -2) thay vì theo index mảng → nút Lên/Xuống vô nghĩa, text luôn đè media.

---

## 2. Quyết định kiến trúc

- **Không copy nguyên bộ cũ** (20k dòng, kiến trúc 2 canvas + 6 engine). Thay vào đó port từng phân hệ sang kiến trúc hiện tại (1 canvas Three.js), vì:
  - Engine Three.js mới đẹp hơn hẳn và đã có xuất frame-accurate.
  - Bộ cũ phụ thuộc 6 thư viện, 4 cái không còn trong repo.
- **Giữ model dữ liệu của bộ cũ** (px + scaleX/scaleY + filter + timeRange + group) vì toàn bộ Inspector, gizmo, preset đều xoay quanh nó; đổi đơn vị sẽ phải viết lại tất cả.
- **Dùng zustand store** thay `useState` trong page — bộ cũ đã có sẵn logic history/selection/group.
- **Engine đọc z theo index mảng** + watermark vẽ sau cùng.
- **Filter** áp bằng cách bake vào texture khi tạo node (MeshBasicMaterial không có CSS filter); với text/ảnh đã có canvas trung gian nên bake được. Blur/shadow/borderRadius bake bằng canvas 2D trước khi upload texture.

---

## 3. Các phase

### P0 — Sửa tính đúng đắn (0,5 ngày)

| Việc | File |
|---|---|
| Truyền `layers` vào `exportSongNhacFrames` + `engine.setLayers()` trước vòng render | `src/features/song-nhac/export/exportSongNhacFrames.ts` |
| Thêm `layers?:` (optional) vào options; giữ tương thích IPC | `src/features/song-nhac/export/exportSongNhacFrames.ts` |
| Engine: z theo index mảng, watermark pass sau cùng | `src/features/song-nhac/three/AveeVisualizerEngine.ts` |
| Test: export 2 lớp → ffprobe + ảnh trích phải có lớp | `scripts/viz-harness/export-test.ts` |

**Nghiệm thu:** xuất 1 video có ảnh nền + chữ → mở MP4 thấy đúng như preview.

### P1 — Model + store + history (1–2 ngày)

| Việc | File đích |
|---|---|
| Mở rộng layer model: `filter` (15 trường), `timeRange`, `role`, `group` + `parentId`, `fitMode: free/contain/cover`, `naturalWidth/Height`, `waveAroundEnabled`, text `italic/fontWeight string/textShadow*`, visualizer params | `src/features/song-nhac/studio/layerTypes.ts` |
| Port `buildCssFilter`, `getLayerTimeOpacity`, 5 type guard, `DEFAULT_TRANSFORM/DEFAULT_FILTER` | `src/features/song-nhac/studio/layerTypes.ts` |
| Store zustand: layers, selection (đơn + đa), clipboard, history snapshot (limit 50), gesture coalescing, group actions, move/reorder, add Intro/Outro/Logo | `src/features/song-nhac/studio/songNhacLayerStore.ts` (mới) |
| Bỏ `useState` trong page, đọc/ghi qua store; giữ IPC chọn file | `src/pages/Music/SongNhacPage.tsx` |

**Nghiệm thu:** thêm/xoá/nhân bản/kéo thứ tự/undo-redo chạy đúng; `npm test` xanh.

### P2 — Inspector đầy đủ (1–2 ngày)

Các section theo thứ tự port (mỗi section là 1 component nhỏ trong `InspectorPanel.tsx`):

1. Header: sửa tên lớp + nút khoá.
2. **Transform**: X, Y (±9999 px), Scale X/Y (±10), Rotate (±180), Flip X/Y.
3. **Ảnh**: thumbnail, chọn/đổi ảnh, kích thước gốc, Fit mode 3 giá trị.
4. **Video**: Fit mode, Muted, Loop.
5. **Văn bản**: nội dung, cỡ chữ, màu, font (7), đậm/nghiêng.
6. **Viền & bóng chữ**: màu viền, độ dày, shadow X/Y/blur/màu.
7. **Filter** (dùng chung image/video/text): 15 tham số + nút Reset.
8. **Thời gian hiển thị**: start/end/fadeIn/fadeOut + preset Intro 3/5/10s + role watermark.
9. **Visualizer**: waveStyle (31), colorMode, màu chính/phụ, barCount, speed, sensitivity, opacity, glow, mirror.
10. **Hiệu ứng nhạc** (ảnh): beat pulse, sóng quanh ảnh.

**Nghiệm thu:** mỗi control đổi giá trị → preview đổi ngay; undo gộp 1 bước cho mỗi lần kéo slider.

### P3 — LayersPanel đầy đủ (1 ngày)

- Toolbar 8 nút: Ảnh, Text, Wave, Video, Logo, Intro, Outro, Group.
- Danh sách đảo ngược (trên cùng trước), thumbnail, badge watermark/timeRange, trạng thái ẩn/khoá.
- Group: expand/collapse, double-click để sửa thứ tự con, thêm layer vào group.
- Multi-select (Ctrl/Shift), copy/paste/duplicate.
- 10 preset sóng dựng sẵn + template localStorage.

### P4 — Gizmo + phím tắt + toolbar (1–2 ngày)

- `GizmoOverlay`: khung chọn, 4 góc thu phóng, tay xoay, snap, hit-test.
- `useSongNhacKeyboardShortcuts`: Delete, Escape, Ctrl+C/V/D/Z, Ctrl+Shift+Z, Ctrl+Y.
- Toolbar: Undo/Redo/Copy/Paste/Duplicate với disable theo history.

### P5 — Engine nâng cao (1 ngày)

- Filter bake vào texture (brightness/contrast/saturation/hue/grayscale/sepia/blur/tint/borderRadius/shadow).
- Beat pulse cho ảnh (`imageBeatEnabled`, intensity).
- Sóng quanh ảnh (`waveAroundEnabled`) — có thể để phase sau.
- Per-layer visualizer params thay cho theme toàn cục (hoặc map theme → colorMode/color1/color2).

### P6 — Hộp thoại xuất (1 ngày)

- Chọn độ phân giải (1080p/1440p/4K), FPS (24/30/60), bitrate.
- Chọn khoảng thời gian (theo timeRange hoặc start/end tuỳ ý).
- Preset xuất + ước lượng dung lượng.
- 2D fallback: hoặc port `drawLayers` sang canvas, hoặc chặn export và báo lỗi rõ.

---

## 4. Rủi ro đã xác định

| Rủi ro | Giảm thiểu |
|---|---|
| Lệch đơn vị transform (px ↔ phân số) | Chọn model px như bộ cũ, viết lại `fitSize`/engine theo px |
| Opacity trùng (filter.opacity vs transform.opacity) | Bỏ `transform.opacity`, dùng `filter.opacity`; công thức chung: `timeFade × filter.opacity` |
| Gõ text làm recreate texture mỗi ký tự | Debounce 150ms hoặc chỉ cập nhật texture thay vì tạo node |
| History snapshot toàn mảng gây lag | Chỉ push khi kết thúc gesture; giới hạn 50; không clone khi đang gesture |
| Đụng tên `src`/`url`, `fit`/`fitMode` | Chuẩn hoá về tên cũ, viết hàm migrate |
| Engine chạy 31 wave style | Phase đầu chỉ giữ 1–3 style tốt nhất, mở rộng sau |
| Xung đột khi copy file cũ | Không copy; port từng file, build + test sau mỗi phase |

---

## 5. Thứ tự thực thi đề xuất

1. **P0** (bắt buộc trước — nếu không, mọi thứ chỉ đẹp ở preview).
2. **P1** (nền tảng cho mọi phase sau).
3. **P2** và **P3** song song được (2 agent, khác file).
4. **P4**, **P5**, **P6** tuần tự.

Ước lượng: 7–10 phiên làm việc có kiểm thử.
