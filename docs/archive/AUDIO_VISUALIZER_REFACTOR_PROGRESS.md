> ⛔ **ARCHIVED — KHÔNG CÒN CHÍNH XÁC** (2026-04-02)
>
> Kiến trúc `src/components/AudioVisualizer/` đã bị thay thế hoàn toàn bởi `src/features/song-nhac/`.
> Xem [`README.md`](../README.md) → phần "Sóng nhạc (Music Visualizer)" cho tài liệu hiện tại.
>
> ---

# [ARCHIVED] Audio Visualizer Refactor Progress

## ✅ Đã hoàn thành

### 1. Services Layer
- ✅ **AudioService.ts**: Service xử lý audio, FFT, audio context management
- ✅ **ExportService.ts**: Service export video, tách biệt khỏi UI logic

### 2. Core Infrastructure
- ✅ **VisualizerRegistry.ts**: Registry pattern để quản lý visualizers, lazy loading

### 3. Hooks
- ✅ **useAudioVisualizer.ts**: Hook chính quản lý state và logic của audio visualizer

### 4. Components
- ✅ **VisualizerCanvas.tsx**: Component render visualizer với lazy loading
- ✅ **AudioControls.tsx**: Component điều khiển audio playback

### 5. Integration vào AudioVisualizerPage
- ✅ Đã import các services và hooks mới
- ✅ Đã tích hợp ExportService vào handleExportVideo
- ✅ Đã thêm useAudioVisualizer hook (đang migrate dần)

## ⏳ Đang làm

### 1. Migrate file selection logic
- ⏳ Thay thế `handleFileSelect` cũ bằng logic từ `useAudioVisualizer`
- ⏳ Giữ nguyên `getFileUrl` helper (cần thiết cho Electron)

### 2. Migrate audio playback logic
- ⏳ Sử dụng `handlePlayPause` từ hook
- ⏳ Sync state giữa hook và local state

### 3. Refactor UI components
- ⏳ Tách các render functions thành components riêng:
  - `renderLayerTab()` → `LayerTab` component
  - `renderAudioTab()` → `AudioTab` component
  - `renderPresetTab()` → `PresetTab` component
  - `renderExportTab()` → `ExportTab` component

## 📝 Notes

### Vấn đề hiện tại:
1. **Duplicate state**: Hook tạo state mới nhưng code cũ vẫn dùng state cũ
   - **Giải pháp**: Migrate từng phần, giữ backward compatibility

2. **File selection**: Logic hiện tại phức tạp với Electron file:// URLs
   - **Giải pháp**: Giữ nguyên logic, wrap trong hook

3. **Visualizer rendering**: Vẫn dùng switch case trực tiếp
   - **Giải pháp**: Migrate sang VisualizerRegistry sau

### Cách tiếp tục:
1. Giữ nguyên functionality hiện tại
2. Migrate từng phần một cách cẩn thận
3. Test sau mỗi migration
4. Không break existing features

## 🎯 Next Steps

1. **Hoàn thiện file selection migration**
   - Wrap `getFileUrl` logic vào hook
   - Sử dụng `handleFileSelect` từ hook

2. **Hoàn thiện audio playback migration**
   - Sync `isPlaying` state
   - Sử dụng `handlePlayPause` từ hook

3. **Tách UI components**
   - Tạo các component nhỏ hơn
   - Giảm complexity của AudioVisualizerPage

4. **Migrate visualizer rendering**
   - Sử dụng VisualizerRegistry
   - Lazy load visualizers

5. **Cleanup**
   - Xóa duplicate code
   - Remove unused imports
   - Update documentation

## 📊 Code Statistics

- **Before**: ~1861 lines trong 1 file
- **After**: Tách thành:
  - Services: ~200 lines
  - Hooks: ~150 lines
  - Components: ~300 lines
  - Main page: ~1800 lines (đang giảm dần)

## ✅ Testing Checklist

- [ ] File selection hoạt động
- [ ] Audio playback hoạt động
- [ ] Visualizer rendering hoạt động
- [ ] Export video hoạt động
- [ ] Layer editing hoạt động
- [ ] Template import/export hoạt động


