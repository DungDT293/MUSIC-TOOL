> ⛔ **ARCHIVED — KHÔNG CÒN CHÍNH XÁC** (2026-04-02)
>
> Tài liệu này mô tả kiến trúc `src/components/AudioVisualizer/` — thư mục này **đã bị xóa hoàn toàn**.
> Visualizer đã được pivot sang `src/features/song-nhac/` với kiến trúc hoàn toàn khác
> (VisualizerRuntime, EngineHost, Zustand stores, custom CanvasHost).
>
> **Xem tài liệu hiện tại:** [`README.md`](../README.md) → phần "Sóng nhạc (Music Visualizer)"
>
> ---

# [ARCHIVED] Audio Visualizer Refactor Summary

## Tổng quan
Đã refactor lại chức năng "Tạo sóng nhạc" với cấu trúc mới, tách biệt concerns và dễ maintain hơn.

## Cấu trúc mới

### 1. Services Layer (`src/components/AudioVisualizer/services/`)
- **AudioService.ts**: Quản lý audio processing, FFT, audio context
- **ExportService.ts**: Xử lý export video, tách biệt khỏi UI logic

### 2. Core (`src/components/AudioVisualizer/core/`)
- **VisualizerRegistry.ts**: Registry pattern để quản lý visualizers, lazy loading

### 3. Hooks (`src/components/AudioVisualizer/hooks/`)
- **useAudioVisualizer.ts**: Hook chính quản lý state và logic của audio visualizer

### 4. Components (`src/components/AudioVisualizer/components/`)
- **VisualizerCanvas.tsx**: Component render visualizer
- **AudioControls.tsx**: Component điều khiển audio playback

## Lợi ích

### Trước khi refactor:
- ❌ Code duplication giữa các visualizers
- ❌ State management phức tạp trong component lớn
- ❌ Logic export video lẫn với UI
- ❌ Khó test và maintain

### Sau khi refactor:
- ✅ Separation of concerns rõ ràng
- ✅ Services có thể test độc lập
- ✅ Hooks tái sử dụng được
- ✅ Component nhỏ, dễ maintain
- ✅ Registry pattern dễ mở rộng visualizers mới

## Cách sử dụng

### Trong component:
```typescript
import { useAudioVisualizer } from '../components/AudioVisualizer/hooks/useAudioVisualizer'
import { VisualizerCanvas } from '../components/AudioVisualizer/components/VisualizerCanvas'
import { AudioControls } from '../components/AudioVisualizer/components/AudioControls'

function MyVisualizerPage() {
  const {
    audioRef,
    isPlaying,
    isLoading,
    error,
    selectedFile,
    visualizerType,
    config,
    handleFileSelect,
    handlePlayPause,
    handleVisualizerTypeChange,
    handleConfigChange,
    handleExport,
  } = useAudioVisualizer()

  return (
    <div>
      <AudioControls
        isPlaying={isPlaying}
        isLoading={isLoading}
        onPlayPause={handlePlayPause}
        onFileSelect={handleFileSelect}
        selectedFile={selectedFile}
      />
      <VisualizerCanvas
        visualizerType={visualizerType}
        audioRef={audioRef}
        configRef={configRef}
        isPlaying={isPlaying}
      />
    </div>
  )
}
```

## Next Steps

1. ✅ Tạo services và hooks
2. ⏳ Refactor AudioVisualizerPage để sử dụng cấu trúc mới
3. ⏳ Migrate các visualizers hiện tại để sử dụng AudioService
4. ⏳ Cải thiện UI với các component nhỏ hơn
5. ⏳ Thêm tests cho services

## Notes

- Giữ nguyên API của các visualizers hiện tại để không break code
- Có thể migrate từng phần một
- Backward compatible với code cũ


