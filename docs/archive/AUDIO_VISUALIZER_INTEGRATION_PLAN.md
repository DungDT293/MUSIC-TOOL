> ⛔ **ARCHIVED** (2026-04-02) — Kiến trúc cũ, đã thay thế bởi `src/features/song-nhac/`.

# [ARCHIVED] Kế hoạch Tích hợp Audio Visualizer - Mã nguồn mở

## Tổng quan
Tài liệu này mô tả kế hoạch tích hợp các dự án mã nguồn mở vào chức năng "Tạo sóng nhạc" hiện tại.

## Trạng thái hiện tại
- **13 loại visualizer** (Canvas 2D)
- **Hệ thống xử lý audio** với FFT
- **Export video** với FFmpeg
- **Parser file .viz** (Avee Player format)
- **Layer system** (background, visualizer, album art, image, text)

## Các dự án sẽ tích hợp

### 1. Butterchurn (MilkDrop cho WebGL) ⭐ Ưu tiên cao
**Repository:** https://github.com/jberg/butterchurn
**Demo:** https://butterchurnviz.com/

**Mục tiêu:**
- Tích hợp Butterchurn như một visualizer mới
- Import presets từ projectM (https://github.com/projectM-visualizer/projectM)
- Thêm vào danh sách visualizer hiện tại

**Lợi ích:**
- Hàng nghìn presets MilkDrop chất lượng cao
- Hiệu ứng 3D WebGL mạnh mẽ
- Cộng đồng lớn và được maintain tốt

**Cách tích hợp:**
```typescript
// Thêm vào VisualizerType
type VisualizerType = 
  | 'blob-ring'
  | 'butterchurn' // NEW
  | ...

// Tạo component mới
src/components/AudioVisualizer/visualizers/ButterchurnVisualizer.tsx
```

**Dependencies cần thêm:**
```json
{
  "butterchurn": "^4.6.0",
  "butterchurn-presets": "^1.0.0"
}
```

---

### 2. AudioMotion-Analyzer ⭐ Ưu tiên cao
**Repository:** https://github.com/hvianna/audioMotion-analyzer

**Mục tiêu:**
- Tích hợp như một visualizer mới
- Sử dụng các preset có sẵn của AudioMotion
- Giữ nguyên API hiện tại

**Lợi ích:**
- Nhiều visualizer đẹp mắt
- Code sạch, dễ maintain
- Tài liệu tốt

**Cách tích hợp:**
```typescript
// Thêm vào VisualizerType
type VisualizerType = 
  | 'blob-ring'
  | 'audiomotion-bars' // NEW
  | 'audiomotion-circular' // NEW
  | ...
```

**Dependencies cần thêm:**
```json
{
  "audiomotion-analyzer": "^4.4.0"
}
```

---

### 3. Wav2Bar (Học hỏi) 📚
**Repository:** https://github.com/kutlugsahin/wav2bar

**Mục tiêu:**
- Học cách export video tự động tốt hơn
- Cải thiện VideoExporter hiện tại
- Tối ưu hóa quy trình export

**Lợi ích:**
- Export video nhanh hơn
- Chất lượng tốt hơn
- Tự động hóa tốt hơn

**Cách tích hợp:**
- Không tích hợp trực tiếp
- Học hỏi và cải thiện `src/components/AudioVisualizer/utils/VideoExporter.ts`
- Cải thiện `src/components/AudioVisualizer/utils/FFmpegMerger.ts`

---

## Kế hoạch thực hiện

### Phase 1: Tích hợp Butterchurn (Tuần 1-2)
1. ✅ Cài đặt dependencies
2. ✅ Tạo ButterchurnVisualizer component
3. ✅ Tích hợp vào AudioVisualizerPage
4. ✅ Test với một số presets
5. ✅ Thêm UI để chọn preset

### Phase 2: Tích hợp AudioMotion (Tuần 3)
1. ✅ Cài đặt dependencies
2. ✅ Tạo AudioMotion visualizers
3. ✅ Tích hợp vào hệ thống
4. ✅ Test và optimize

### Phase 3: Cải thiện Export (Tuần 4)
1. ✅ Nghiên cứu Wav2Bar
2. ✅ Cải thiện VideoExporter
3. ✅ Tối ưu hóa FFmpeg commands
4. ✅ Test export với các visualizer mới

### Phase 4: Polish & Documentation (Tuần 5)
1. ✅ Viết documentation
2. ✅ Tối ưu performance
3. ✅ Fix bugs
4. ✅ Release

---

## Cấu trúc code mới

```
src/components/AudioVisualizer/
├── visualizers/
│   ├── ButterchurnVisualizer.tsx      # NEW
│   ├── AudioMotionBarsVisualizer.tsx  # NEW
│   ├── AudioMotionCircularVisualizer.tsx # NEW
│   └── ...
├── presets/
│   ├── butterchurn/                   # NEW - Butterchurn presets
│   └── audiomotion/                    # NEW - AudioMotion presets
└── utils/
    ├── VideoExporter.ts               # IMPROVED
    └── FFmpegMerger.ts                # IMPROVED
```

---

## Dependencies mới

```json
{
  "dependencies": {
    "butterchurn": "^4.6.0",
    "audiomotion-analyzer": "^4.4.0"
  }
}
```

---

## Notes
- Giữ nguyên API hiện tại để không break existing code
- Tất cả visualizer mới phải implement BaseVisualizerProps
- Export video phải hoạt động với tất cả visualizer mới
- Performance là ưu tiên hàng đầu

---

## References
- Butterchurn: https://github.com/jberg/butterchurn
- AudioMotion: https://github.com/hvianna/audioMotion-analyzer
- Wav2Bar: https://github.com/kutlugsahin/wav2bar
- projectM Presets: https://github.com/projectM-visualizer/projectM


